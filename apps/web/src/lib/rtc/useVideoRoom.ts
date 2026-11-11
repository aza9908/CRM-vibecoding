'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  WS_EVENTS,
  type ClientToServerEvents,
  type RtcJoinAck,
  type RtcMediaState,
  type RtcModerateAction,
  type RtcPeer,
  type RtcSignalRelay,
  type ServerToClientEvents,
} from '@lms/shared';

/**
 * Video room for a live session — our own meeting room inside the LMS.
 *
 * Topology: WebRTC mesh. Every pair of people in the room shares one
 * RTCPeerConnection; media flows browser-to-browser and the API only relays
 * SDP/ICE over the existing Socket.IO `/live` namespace. A connection only
 * carries traffic when one side publishes (mic, camera or screen), so a
 * lecture — one host on camera + screen, viewers listening — stays light.
 *
 * Negotiation uses the standard "perfect negotiation" pattern: the peer with
 * the smaller id is polite and yields on offer collisions.
 */

type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type VideoRoomStatus = 'idle' | 'joining' | 'joined' | 'error';

export interface RemotePeer extends RtcPeer {
  /** Camera (+ mic) stream as received. */
  camera: MediaStream | null;
  /** Screen-share stream as received. */
  screen: MediaStream | null;
}

const NO_MEDIA: RtcMediaState = {
  audio: false,
  video: false,
  screen: false,
  hand: false,
  cameraStreamId: null,
  screenStreamId: null,
};

/** Bitrate caps keep a 20–30 person mesh within a normal uplink. */
const CAMERA_MAX_BITRATE = 450_000;
const SCREEN_MAX_BITRATE = 1_200_000;

type TrackKind = 'audio' | 'video' | 'screen';

interface PeerLink {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: Partial<Record<TrackKind, RTCRtpSender>>;
}

function resolveWsUrl(): string {
  const raw = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001/live';
  return raw
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:')
    .replace(/\/$/, '');
}

async function capSender(sender: RTCRtpSender, kind: TrackKind): Promise<void> {
  if (kind === 'audio') return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0]!.maxBitrate =
      kind === 'screen' ? SCREEN_MAX_BITRATE : CAMERA_MAX_BITRATE;
    if (kind === 'screen') params.encodings[0]!.maxFramerate = 15;
    await sender.setParameters(params);
  } catch {
    /* not supported before negotiation in some browsers — best-effort */
  }
}

export interface UseVideoRoomResult {
  status: VideoRoomStatus;
  error: string | null;
  selfId: string | null;
  role: RtcPeer['role'] | null;
  peers: RemotePeer[];
  media: RtcMediaState;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  join: (opts?: { audio?: boolean; video?: boolean }) => Promise<void>;
  leave: () => void;
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  toggleHand: () => void;
  moderate: (target: string, action: RtcModerateAction) => void;
  /** Last moderation applied to me (for a toast). */
  moderatedAt: { action: RtcModerateAction; at: number } | null;
}

export function useVideoRoom(
  sessionId: string | undefined,
  token: string | null | undefined,
): UseVideoRoomResult {
  const [status, setStatus] = useState<VideoRoomStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [role, setRole] = useState<RtcPeer['role'] | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [media, setMedia] = useState<RtcMediaState>(NO_MEDIA);
  const [localCamera, setLocalCamera] = useState<MediaStream | null>(null);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [moderatedAt, setModeratedAt] =
    useState<UseVideoRoomResult['moderatedAt']>(null);

  const socketRef = useRef<LiveSocket | null>(null);
  const linksRef = useRef(new Map<string, PeerLink>());
  const selfIdRef = useRef<string | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const mediaRef = useRef<RtcMediaState>(NO_MEDIA);
  const tracksRef = useRef<Partial<Record<TrackKind, MediaStreamTrack>>>({});
  // Stable stream objects so msid (stream id) stays constant for receivers.
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const peersRef = useRef<RemotePeer[]>([]);
  peersRef.current = peers;

  // ── helpers ──────────────────────────────────────────────────────────────

  const publishState = useCallback((next: RtcMediaState) => {
    mediaRef.current = next;
    setMedia(next);
    const sid = sessionIdRef.current;
    if (sid && socketRef.current?.connected && selfIdRef.current) {
      socketRef.current.emit(WS_EVENTS.rtcState, { sessionId: sid, media: next });
    }
  }, []);

  /** Route an incoming track to the camera or screen slot of its peer. */
  const onRemoteTrack = useCallback(
    (peerId: string, ev: RTCTrackEvent) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      setPeers((prev) =>
        prev.map((p) => {
          if (p.peerId !== peerId) return p;
          const isScreen =
            !!p.media.screenStreamId && stream.id === p.media.screenStreamId;
          return isScreen ? { ...p, screen: stream } : { ...p, camera: stream };
        }),
      );
      ev.track.onunmute = () => {
        // Force a re-render so <video> elements pick up revived tracks.
        setPeers((prev) => [...prev]);
      };
    },
    [],
  );

  const sendSignal = useCallback(
    (to: string, data: Omit<RtcSignalRelay, 'from'>) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      socketRef.current?.emit(WS_EVENTS.rtcSignal, { sessionId: sid, to, ...data });
    },
    [],
  );

  const attachLocalTracks = useCallback((link: PeerLink) => {
    const tracks = tracksRef.current;
    (['audio', 'video', 'screen'] as TrackKind[]).forEach((kind) => {
      const track = tracks[kind];
      if (!track || link.senders[kind]) return;
      const stream =
        kind === 'screen' ? screenStreamRef.current : cameraStreamRef.current;
      if (!stream) return;
      link.senders[kind] = link.pc.addTrack(track, stream);
      void capSender(link.senders[kind]!, kind);
    });
  }, []);

  const ensureLink = useCallback(
    (peerId: string): PeerLink => {
      const existing = linksRef.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      const link: PeerLink = {
        pc,
        polite: (selfIdRef.current ?? '') < peerId,
        makingOffer: false,
        ignoreOffer: false,
        senders: {},
      };
      linksRef.current.set(peerId, link);

      pc.onnegotiationneeded = async () => {
        try {
          link.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendSignal(peerId, {
              description: pc.localDescription.toJSON() as RtcSignalRelay['description'],
            });
          }
        } catch (err) {
          console.warn('[video] negotiation failed', err);
        } finally {
          link.makingOffer = false;
        }
      };
      pc.onicecandidate = ({ candidate }) => {
        sendSignal(peerId, { candidate: candidate ? candidate.toJSON() : null });
      };
      pc.ontrack = (ev) => onRemoteTrack(peerId, ev);
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') pc.restartIce();
      };

      attachLocalTracks(link);
      return link;
    },
    [attachLocalTracks, onRemoteTrack, sendSignal],
  );

  const closeLink = useCallback((peerId: string) => {
    const link = linksRef.current.get(peerId);
    if (!link) return;
    link.pc.ontrack = null;
    link.pc.onicecandidate = null;
    link.pc.onnegotiationneeded = null;
    link.pc.close();
    linksRef.current.delete(peerId);
  }, []);

  const handleSignal = useCallback(
    async ({ from, description, candidate }: RtcSignalRelay) => {
      const link = ensureLink(from);
      const { pc } = link;
      try {
        if (description) {
          const collision =
            description.type === 'offer' &&
            (link.makingOffer || pc.signalingState !== 'stable');
          link.ignoreOffer = !link.polite && collision;
          if (link.ignoreOffer) return;
          await pc.setRemoteDescription(description as RTCSessionDescriptionInit);
          if (description.type === 'offer') {
            await pc.setLocalDescription();
            if (pc.localDescription) {
              sendSignal(from, {
                description: pc.localDescription.toJSON() as RtcSignalRelay['description'],
              });
            }
          }
        } else if (candidate !== undefined) {
          try {
            await pc.addIceCandidate(
              candidate ? (candidate as RTCIceCandidateInit) : undefined,
            );
          } catch (err) {
            if (!link.ignoreOffer) throw err;
          }
        }
      } catch (err) {
        console.warn('[video] signal error', err);
      }
    },
    [ensureLink, sendSignal],
  );

  /** Put a local track on every connection (add or replace). */
  const publishTrack = useCallback(
    (kind: TrackKind, track: MediaStreamTrack | null) => {
      if (track) tracksRef.current[kind] = track;
      else delete tracksRef.current[kind];
      for (const link of linksRef.current.values()) {
        const sender = link.senders[kind];
        if (sender) {
          void sender.replaceTrack(track);
        } else if (track) {
          const stream =
            kind === 'screen' ? screenStreamRef.current : cameraStreamRef.current;
          if (!stream) continue;
          link.senders[kind] = link.pc.addTrack(track, stream);
          void capSender(link.senders[kind]!, kind);
        }
      }
    },
    [],
  );

  const stopLocal = useCallback(() => {
    for (const track of Object.values(tracksRef.current)) track?.stop();
    tracksRef.current = {};
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setLocalCamera(null);
    setLocalScreen(null);
  }, []);

  const resetLinks = useCallback(() => {
    for (const id of [...linksRef.current.keys()]) closeLink(id);
    setPeers([]);
  }, [closeLink]);

  // ── socket lifecycle ─────────────────────────────────────────────────────

  const wantJoinedRef = useRef(false);

  const doJoin = useCallback(() => {
    const socket = socketRef.current;
    const sid = sessionIdRef.current;
    if (!socket || !sid) return;
    setStatus('joining');
    socket.emit(
      WS_EVENTS.rtcJoin,
      { sessionId: sid, media: mediaRef.current },
      (ack: RtcJoinAck) => {
        if (!ack?.ok || !ack.selfId) {
          setStatus('error');
          setError(ack?.error ?? 'join_failed');
          return;
        }
        resetLinks();
        selfIdRef.current = ack.selfId;
        iceRef.current = (ack.iceServers ?? []) as RTCIceServer[];
        setSelfId(ack.selfId);
        setRole(ack.role ?? 'participant');
        setPeers(
          (ack.peers ?? []).map((p) => ({ ...p, camera: null, screen: null })),
        );
        setError(null);
        setStatus('joined');
        // Existing members: open a link now if I publish — negotiation starts
        // from my side. If only they publish, they open it on peer-joined.
        if (Object.keys(tracksRef.current).length > 0) {
          for (const p of ack.peers ?? []) ensureLink(p.peerId);
        }
      },
    );
  }, [ensureLink, resetLinks]);

  const ensureSocket = useCallback((): LiveSocket | null => {
    if (socketRef.current) return socketRef.current;
    const auth = tokenRef.current;
    if (!auth) return null;
    const socket: LiveSocket = io(resolveWsUrl(), {
      transports: ['websocket', 'polling'],
      auth: { token: auth },
      query: { token: auth },
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 800,
      timeout: 12_000,
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // New socket id after a reconnect → every link must be rebuilt.
      if (wantJoinedRef.current) doJoin();
    });
    socket.on('connect_error', (err) => {
      if (wantJoinedRef.current) {
        setStatus('error');
        setError(err.message);
      }
    });

    socket.on(WS_EVENTS.rtcPeerJoined, (peer) => {
      setPeers((prev) => [
        ...prev.filter((p) => p.peerId !== peer.peerId),
        { ...peer, camera: null, screen: null },
      ]);
      if (Object.keys(tracksRef.current).length > 0) ensureLink(peer.peerId);
    });
    socket.on(WS_EVENTS.rtcPeerLeft, ({ peerId }) => {
      closeLink(peerId);
      setPeers((prev) => prev.filter((p) => p.peerId !== peerId));
    });
    socket.on(WS_EVENTS.rtcPeerState, ({ peerId, media: m }) => {
      setPeers((prev) =>
        prev.map((p) => {
          if (p.peerId !== peerId) return p;
          const next: RemotePeer = { ...p, media: m };
          if (!m.screen) next.screen = null;
          // A stream that arrived before its id was announced may sit in
          // the camera slot — move it once we know it is the screen.
          if (m.screenStreamId && p.camera?.id === m.screenStreamId) {
            next.screen = p.camera;
            next.camera = null;
          }
          return next;
        }),
      );
    });
    socket.on(WS_EVENTS.rtcSignal, (relay) => {
      void handleSignal(relay);
    });
    socket.on(WS_EVENTS.rtcModerate, ({ action }) => {
      setModeratedAt({ action, at: Date.now() });
      const cur = mediaRef.current;
      if (action === 'mute' && cur.audio) {
        const t = tracksRef.current.audio;
        if (t) t.enabled = false;
        publishState({ ...cur, audio: false });
      } else if (action === 'stop-video' && cur.video) {
        tracksRef.current.video?.stop();
        publishTrack('video', null);
        publishState({ ...cur, video: false });
      } else if (action === 'lower-hand' && cur.hand) {
        publishState({ ...cur, hand: false });
      }
    });
    return socket;
  }, [closeLink, doJoin, ensureLink, handleSignal, publishState, publishTrack]);

  const leave = useCallback(() => {
    wantJoinedRef.current = false;
    const sid = sessionIdRef.current;
    if (sid) socketRef.current?.emit(WS_EVENTS.rtcLeave, { sessionId: sid });
    resetLinks();
    stopLocal();
    mediaRef.current = NO_MEDIA;
    setMedia(NO_MEDIA);
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    socketRef.current = null;
    selfIdRef.current = null;
    setSelfId(null);
    setRole(null);
    setStatus('idle');
  }, [resetLinks, stopLocal]);

  // Leave on unmount / session change.
  useEffect(() => () => leave(), [sessionId, leave]);

  // ── local media ──────────────────────────────────────────────────────────

  const getCameraStream = useCallback((): MediaStream => {
    if (!cameraStreamRef.current) {
      cameraStreamRef.current = new MediaStream();
    }
    return cameraStreamRef.current;
  }, []);

  const enableAudio = useCallback(async (): Promise<boolean> => {
    const existing = tracksRef.current.audio;
    if (existing && existing.readyState === 'live') {
      existing.enabled = true;
      return true;
    }
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const track = s.getAudioTracks()[0];
    if (!track) return false;
    const cam = getCameraStream();
    cam.getAudioTracks().forEach((t) => cam.removeTrack(t));
    cam.addTrack(track);
    setLocalCamera(new MediaStream(cam.getTracks()));
    publishTrack('audio', track);
    return true;
  }, [getCameraStream, publishTrack]);

  const enableVideo = useCallback(async (): Promise<boolean> => {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 24, max: 24 },
      },
    });
    const track = s.getVideoTracks()[0];
    if (!track) return false;
    const cam = getCameraStream();
    cam.getVideoTracks().forEach((t) => {
      t.stop();
      cam.removeTrack(t);
    });
    cam.addTrack(track);
    setLocalCamera(new MediaStream(cam.getTracks()));
    publishTrack('video', track);
    return true;
  }, [getCameraStream, publishTrack]);

  /** After publishing new tracks, open links to everyone who has none yet. */
  const linkEveryone = useCallback(() => {
    for (const p of peersRef.current) ensureLink(p.peerId);
  }, [ensureLink]);

  const join = useCallback(
    async (opts: { audio?: boolean; video?: boolean } = {}) => {
      if (!sessionIdRef.current) return;
      setError(null);
      let next: RtcMediaState = { ...NO_MEDIA };
      try {
        if (opts.audio && (await enableAudio())) next = { ...next, audio: true };
        if (opts.video && (await enableVideo())) next = { ...next, video: true };
      } catch {
        setError('media_denied');
      }
      next.cameraStreamId = cameraStreamRef.current?.id ?? null;
      mediaRef.current = next;
      setMedia(next);
      wantJoinedRef.current = true;
      const socket = ensureSocket();
      if (!socket) {
        setStatus('error');
        setError('no_token');
        return;
      }
      if (socket.connected) doJoin();
      else setStatus('joining');
    },
    [doJoin, enableAudio, enableVideo, ensureSocket],
  );

  const toggleAudio = useCallback(async () => {
    const cur = mediaRef.current;
    if (cur.audio) {
      const t = tracksRef.current.audio;
      if (t) t.enabled = false;
      publishState({ ...cur, audio: false });
      return;
    }
    try {
      if (!(await enableAudio())) return;
      publishState({
        ...mediaRef.current,
        audio: true,
        cameraStreamId: cameraStreamRef.current?.id ?? null,
      });
      linkEveryone();
    } catch {
      setError('media_denied');
    }
  }, [enableAudio, linkEveryone, publishState]);

  const toggleVideo = useCallback(async () => {
    const cur = mediaRef.current;
    if (cur.video) {
      const t = tracksRef.current.video;
      t?.stop();
      if (t) cameraStreamRef.current?.removeTrack(t);
      publishTrack('video', null);
      setLocalCamera(
        cameraStreamRef.current
          ? new MediaStream(cameraStreamRef.current.getTracks())
          : null,
      );
      publishState({ ...cur, video: false });
      return;
    }
    try {
      if (!(await enableVideo())) return;
      publishState({
        ...mediaRef.current,
        video: true,
        cameraStreamId: cameraStreamRef.current?.id ?? null,
      });
      linkEveryone();
    } catch {
      setError('media_denied');
    }
  }, [enableVideo, linkEveryone, publishState, publishTrack]);

  const stopScreen = useCallback(() => {
    tracksRef.current.screen?.stop();
    publishTrack('screen', null);
    setLocalScreen(null);
    publishState({ ...mediaRef.current, screen: false });
  }, [publishState, publishTrack]);

  const toggleScreen = useCallback(async () => {
    if (mediaRef.current.screen) {
      stopScreen();
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 15 } },
        audio: false,
      });
      const track = s.getVideoTracks()[0];
      if (!track) return;
      if ('contentHint' in track) track.contentHint = 'detail';
      track.onended = () => stopScreen();
      if (!screenStreamRef.current) screenStreamRef.current = new MediaStream();
      const scr = screenStreamRef.current;
      scr.getTracks().forEach((t) => scr.removeTrack(t));
      scr.addTrack(track);
      setLocalScreen(new MediaStream([track]));
      // Announce the stream id BEFORE the track lands so receivers route it.
      publishState({
        ...mediaRef.current,
        screen: true,
        screenStreamId: scr.id,
      });
      publishTrack('screen', track);
      linkEveryone();
    } catch {
      /* user cancelled the picker */
    }
  }, [linkEveryone, publishState, publishTrack, stopScreen]);

  const toggleHand = useCallback(() => {
    publishState({ ...mediaRef.current, hand: !mediaRef.current.hand });
  }, [publishState]);

  const moderate = useCallback((target: string, action: RtcModerateAction) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    socketRef.current?.emit(WS_EVENTS.rtcModerate, { sessionId: sid, target, action });
  }, []);

  return {
    status,
    error,
    selfId,
    role,
    peers,
    media,
    localCamera,
    localScreen,
    join,
    leave,
    toggleAudio,
    toggleVideo,
    toggleScreen,
    toggleHand,
    moderate,
    moderatedAt,
  };
}
