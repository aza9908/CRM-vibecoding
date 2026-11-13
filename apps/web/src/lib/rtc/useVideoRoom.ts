'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Device, type types as msc } from 'mediasoup-client';
import {
  WS_EVENTS,
  type ClientToServerEvents,
  type RtcJoinAck,
  type RtcMediaState,
  type RtcModerateAction,
  type RtcPeer,
  type RtcProducerInfo,
  type RtcSource,
  type ServerToClientEvents,
} from '@lms/shared';
import { LIVE_SOCKET_TRANSPORTS, resolveLiveSocketUrl } from '@/lib/ws/url';

/**
 * Video room for a live session — our own meeting room inside the LMS.
 *
 * Topology: SFU. Everyone sends each track once to the media server inside
 * the API (mediasoup) and receives the others' tracks from it, so a class of
 * 50+ costs the teacher one upload. Signaling rides the existing Socket.IO
 * `/live` namespace.
 *
 * Resilience rules:
 *  - a socket drop or a media-server restart never "kicks" anyone: the hook
 *    goes to `reconnecting`, keeps the local mic/camera tracks alive and
 *    re-joins by itself;
 *  - a flaky network path triggers an ICE restart before a full re-join;
 *  - the call ends only on `rtc:call-ended` (host ended it / session ended).
 */

type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type VideoRoomStatus =
  | 'idle'
  | 'joining'
  | 'joined'
  | 'reconnecting'
  | 'error';

export interface RemotePeer extends RtcPeer {
  /** Camera video + microphone audio as received. */
  camera: MediaStream | null;
  /** Screen-share video (+ tab audio) as received. */
  screen: MediaStream | null;
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
  /** Peer ids (mine included) heard right now, loudest first. */
  speaking: string[];
  /** The person who "has the floor" — sticky, to avoid flicker. */
  dominantId: string | null;
  join: (opts?: { audio?: boolean; video?: boolean }) => Promise<void>;
  leave: () => void;
  /** Host: end the call for everyone. */
  endCall: () => void;
  /** Host: tell everyone the call is (not) being recorded. */
  setRecording: (on: boolean) => void;
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  toggleHand: () => void;
  moderate: (target: string, action: RtcModerateAction) => void;
  /** Tell the server whose camera is on the main stage (gets best quality). */
  setStage: (peerId: string | null) => void;
  /** Last moderation applied to me (for a toast). */
  moderatedAt: { action: RtcModerateAction; at: number } | null;
  /** Set when the host ended the call while I was in it (for a toast). */
  endedAt: number | null;
}

const NO_MEDIA: RtcMediaState = {
  audio: false,
  video: false,
  screen: false,
  hand: false,
  cameraStreamId: null,
  screenStreamId: null,
};

/** How many remote cameras are received at once (others stay as avatars). */
const MAX_REMOTE_VIDEOS =
  typeof window !== 'undefined' && window.innerWidth < 640 ? 6 : 16;

const CAMERA_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 110_000, maxFramerate: 15 },
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 320_000, maxFramerate: 24 },
  { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 950_000, maxFramerate: 24 },
];
const SCREEN_ENCODINGS: RTCRtpEncodingParameters[] = [
  { maxBitrate: 2_000_000, maxFramerate: 15 },
];

// ── reload survival ─────────────────────────────────────────────────────────

interface CallResume {
  callId: string | null;
  audio: boolean;
  video: boolean;
}

const resumeKey = (sessionId: string) => `airl-call:${sessionId}`;

/** What I had on before a reload (same tab), if I was in this call. */
export function readCallResume(sessionId: string | undefined): CallResume | null {
  if (!sessionId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(resumeKey(sessionId));
    return raw ? (JSON.parse(raw) as CallResume) : null;
  } catch {
    return null;
  }
}

function writeCallResume(sessionId: string | undefined, value: CallResume | null): void {
  if (!sessionId || typeof window === 'undefined') return;
  try {
    if (value) window.sessionStorage.setItem(resumeKey(sessionId), JSON.stringify(value));
    else window.sessionStorage.removeItem(resumeKey(sessionId));
  } catch {
    /* private mode — reload survival is best-effort */
  }
}

/** Random id of this tab, stable across reloads and reconnects. */
function tabClientId(): string {
  const make = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  try {
    const key = 'airl-rtc-client';
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const id = make();
    window.sessionStorage.setItem(key, id);
    return id;
  } catch {
    return make();
  }
}

interface ConsumerEntry {
  consumer: msc.Consumer;
  info: RtcProducerInfo;
  /** Paused by the "max remote videos" policy. */
  parked: boolean;
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
  const [speaking, setSpeaking] = useState<string[]>([]);
  const [dominantId, setDominantId] = useState<string | null>(null);
  const [moderatedAt, setModeratedAt] =
    useState<UseVideoRoomResult['moderatedAt']>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);

  const socketRef = useRef<LiveSocket | null>(null);
  const deviceRef = useRef<msc.Device | null>(null);
  const sendRef = useRef<msc.Transport | null>(null);
  const recvRef = useRef<msc.Transport | null>(null);
  const producersRef = useRef(new Map<RtcSource, msc.Producer>());
  /** producerId → consumer */
  const consumersRef = useRef(new Map<string, ConsumerEntry>());
  /** producerId → info, for everything published in the room (not by me). */
  const knownRef = useRef(new Map<string, RtcProducerInfo>());
  const consumingRef = useRef(new Set<string>());
  const tracksRef = useRef<Partial<Record<RtcSource, MediaStreamTrack>>>({});
  const selfIdRef = useRef<string | null>(null);
  const mediaRef = useRef<RtcMediaState>(NO_MEDIA);
  const callIdRef = useRef<string | null>(null);
  const stageRef = useRef<string | null>(null);
  const lastSpokeRef = useRef(new Map<string, number>());
  const peersRef = useRef<RemotePeer[]>([]);
  peersRef.current = peers;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const wantJoinedRef = useRef(false);
  const everJoinedRef = useRef(false);
  const joinSeqRef = useRef(0);

  // ── small helpers ────────────────────────────────────────────────────────

  /** Emit with an ack and a timeout — never hangs forever. */
  const request = useCallback(
    <T extends { ok: boolean; error?: string }>(
      event: string,
      payload: unknown,
      timeoutMs = 10_000,
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          reject(new Error('offline'));
          return;
        }
        const timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
        (socket as unknown as Socket).emit(event, payload, (res: T) => {
          window.clearTimeout(timer);
          if (res?.ok) resolve(res);
          else reject(new Error(res?.error ?? 'failed'));
        });
      }),
    [],
  );

  const saveResume = useCallback(() => {
    const m = mediaRef.current;
    writeCallResume(sessionIdRef.current, {
      callId: callIdRef.current,
      audio: m.audio,
      video: m.video,
    });
  }, []);

  const publishState = useCallback(
    (next: RtcMediaState) => {
      mediaRef.current = next;
      setMedia(next);
      const sid = sessionIdRef.current;
      if (sid && socketRef.current?.connected && selfIdRef.current) {
        socketRef.current.emit(WS_EVENTS.rtcState, { sessionId: sid, media: next });
      }
      if (wantJoinedRef.current) saveResume();
    },
    [saveResume],
  );

  /** Rebuild one peer's MediaStreams from its live consumers. */
  const rebuildStreams = useCallback((peerId: string) => {
    const cam: MediaStreamTrack[] = [];
    const scr: MediaStreamTrack[] = [];
    for (const { consumer, info, parked } of consumersRef.current.values()) {
      if (info.peerId !== peerId || parked || consumer.closed) continue;
      if (info.source === 'mic' || info.source === 'camera') cam.push(consumer.track);
      else scr.push(consumer.track);
    }
    setPeers((prev) =>
      prev.map((p) =>
        p.peerId === peerId
          ? {
              ...p,
              camera: cam.length ? new MediaStream(cam) : null,
              screen: scr.length ? new MediaStream(scr) : null,
            }
          : p,
      ),
    );
  }, []);

  const setLayer = useCallback((producerId: string, spatialLayer: number) => {
    const entry = consumersRef.current.get(producerId);
    if (!entry || entry.consumer.kind !== 'video') return;
    socketRef.current?.emit(WS_EVENTS.rtcConsumerLayers, {
      consumerId: entry.consumer.id,
      spatialLayer,
    });
  }, []);

  const consume = useCallback(
    async (info: RtcProducerInfo) => {
      const recv = recvRef.current;
      const device = deviceRef.current;
      if (!recv || !device) return;
      if (consumersRef.current.has(info.producerId)) return;
      if (consumingRef.current.has(info.producerId)) return;
      consumingRef.current.add(info.producerId);
      try {
        const res = await request<{ ok: boolean; params?: unknown }>(
          WS_EVENTS.rtcConsume,
          { producerId: info.producerId, rtpCapabilities: device.rtpCapabilities },
        );
        if (recvRef.current !== recv || !knownRef.current.has(info.producerId)) return;
        const consumer = await recv.consume(
          res.params as Parameters<msc.Transport['consume']>[0],
        );
        consumersRef.current.set(info.producerId, { consumer, info, parked: false });
        consumer.on('transportclose', () => consumersRef.current.delete(info.producerId));
        await request(WS_EVENTS.rtcConsumerPause, {
          consumerId: consumer.id,
          paused: false,
        }).catch(() => undefined);
        if (info.source === 'screen') setLayer(info.producerId, 2);
        else if (info.source === 'camera' && stageRef.current === info.peerId) {
          setLayer(info.producerId, 2);
        }
        rebuildStreams(info.peerId);
      } catch (err) {
        console.warn('[video] consume failed', info.source, err);
      } finally {
        consumingRef.current.delete(info.producerId);
      }
    },
    [rebuildStreams, request, setLayer],
  );

  /**
   * Decide what to receive: every audio and screen track, plus cameras for
   * the stage, hosts, recent speakers, then the rest — up to a cap, so 50
   * cameras do not melt a phone. Parked cameras show as avatars.
   */
  const syncTimer = useRef<number | null>(null);
  const syncConsumers = useCallback(() => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null;
      const cams: RtcProducerInfo[] = [];
      for (const info of knownRef.current.values()) {
        if (info.source === 'camera') cams.push(info);
        else void consume(info);
      }
      const hostIds = new Set(
        peersRef.current.filter((p) => p.role === 'host').map((p) => p.peerId),
      );
      const rank = (i: RtcProducerInfo) =>
        (i.peerId === stageRef.current ? 4e15 : 0) +
        (hostIds.has(i.peerId) ? 2e15 : 0) +
        (lastSpokeRef.current.get(i.peerId) ?? 0);
      cams.sort((a, b) => rank(b) - rank(a));
      cams.forEach((info, index) => {
        const wanted = index < MAX_REMOTE_VIDEOS;
        const entry = consumersRef.current.get(info.producerId);
        if (!entry) {
          if (wanted) void consume(info);
          return;
        }
        if (entry.parked === !wanted) return;
        entry.parked = !wanted;
        socketRef.current?.emit(WS_EVENTS.rtcConsumerPause, {
          consumerId: entry.consumer.id,
          paused: !wanted,
        });
        rebuildStreams(info.peerId);
      });
    }, 120);
  }, [consume, rebuildStreams]);

  // ── transports ───────────────────────────────────────────────────────────

  const rejoinRef = useRef<() => void>(() => undefined);

  const watchTransport = useCallback(
    (transport: msc.Transport) => {
      let timer: number | null = null;
      const restart = async () => {
        if (transport.closed) return;
        try {
          const res = await request<{ ok: boolean; iceParameters?: unknown }>(
            WS_EVENTS.rtcTransportRestartIce,
            { transportId: transport.id },
          );
          await transport.restartIce({
            iceParameters: res.iceParameters as msc.IceParameters,
          });
        } catch {
          /* fall through to the watchdog below */
        }
      };
      transport.on('connectionstatechange', (state) => {
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }
        if (state === 'connected' || state === 'closed') return;
        if (state === 'failed') void restart();
        if (state === 'disconnected' || state === 'failed') {
          // A short blip heals by itself; otherwise restart ICE, and if the
          // path is still dead after that, rebuild the whole connection.
          timer = window.setTimeout(() => {
            if (transport.closed || transport.connectionState === 'connected') return;
            void restart();
            timer = window.setTimeout(() => {
              if (transport.closed || transport.connectionState === 'connected') return;
              rejoinRef.current();
            }, 8_000);
          }, 2_500);
        }
      });
    },
    [request],
  );

  const createTransport = useCallback(
    async (direction: 'send' | 'recv'): Promise<msc.Transport> => {
      const device = deviceRef.current;
      if (!device) throw new Error('no_device');
      const res = await request<{ ok: boolean; params?: unknown }>(
        WS_EVENTS.rtcTransportCreate,
        { direction },
      );
      const params = res.params as msc.TransportOptions;
      const transport =
        direction === 'send'
          ? device.createSendTransport(params)
          : device.createRecvTransport(params);
      transport.on('connect', ({ dtlsParameters }, done, fail) => {
        request(WS_EVENTS.rtcTransportConnect, {
          transportId: transport.id,
          dtlsParameters,
        })
          .then(() => done())
          .catch((e: Error) => fail(e));
      });
      if (direction === 'send') {
        transport.on('produce', ({ kind, rtpParameters, appData }, done, fail) => {
          request<{ ok: boolean; producerId?: string }>(WS_EVENTS.rtcProduce, {
            transportId: transport.id,
            kind,
            rtpParameters,
            source: (appData as { source: RtcSource }).source,
          })
            .then((r) => done({ id: r.producerId! }))
            .catch((e: Error) => fail(e));
        });
      }
      watchTransport(transport);
      return transport;
    },
    [request, watchTransport],
  );

  /** Send a local track to the room (replacing a previous one of its kind). */
  const publish = useCallback(
    async (source: RtcSource, track: MediaStreamTrack) => {
      tracksRef.current[source] = track;
      const device = deviceRef.current;
      if (!device || !selfIdRef.current) return; // sent on (re)join
      const old = producersRef.current.get(source);
      if (old && !old.closed) {
        await old.replaceTrack({ track });
        if (old.paused) {
          old.resume();
          socketRef.current?.emit(WS_EVENTS.rtcProducerPause, {
            producerId: old.id,
            paused: false,
          });
        }
        return;
      }
      if (!sendRef.current || sendRef.current.closed) {
        sendRef.current = await createTransport('send');
      }
      const video = track.kind === 'video';
      const producer = await sendRef.current.produce({
        track,
        stopTracks: false,
        appData: { source },
        ...(video
          ? {
              encodings: source === 'screen' ? SCREEN_ENCODINGS : CAMERA_ENCODINGS,
              codecOptions: { videoGoogleStartBitrate: 800 },
            }
          : { codecOptions: { opusDtx: true, opusFec: true, opusStereo: false } }),
      });
      producersRef.current.set(source, producer);
      producer.on('transportclose', () => {
        if (producersRef.current.get(source) === producer) {
          producersRef.current.delete(source);
        }
      });
    },
    [createTransport],
  );

  const unpublish = useCallback((source: RtcSource) => {
    delete tracksRef.current[source];
    const producer = producersRef.current.get(source);
    if (!producer) return;
    producersRef.current.delete(source);
    if (!producer.closed) producer.close();
    socketRef.current?.emit(WS_EVENTS.rtcProducerClose, { producerId: producer.id });
  }, []);

  /** Drop every server-side object; local tracks stay alive for a re-join. */
  const teardown = useCallback(() => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    sendRef.current?.close();
    recvRef.current?.close();
    sendRef.current = null;
    recvRef.current = null;
    producersRef.current.clear();
    consumersRef.current.clear();
    consumingRef.current.clear();
    knownRef.current.clear();
    deviceRef.current = null;
  }, []);

  const stopLocal = useCallback(() => {
    for (const track of Object.values(tracksRef.current)) track?.stop();
    tracksRef.current = {};
    setLocalCamera(null);
    setLocalScreen(null);
  }, []);

  // ── join / socket lifecycle ──────────────────────────────────────────────

  const doJoin = useCallback(() => {
    const socket = socketRef.current;
    const sid = sessionIdRef.current;
    if (!socket || !sid) return;
    const seq = ++joinSeqRef.current;
    setStatus(everJoinedRef.current ? 'reconnecting' : 'joining');
    teardown();
    selfIdRef.current = null;
    // Never spin forever: if the server does not answer, retry / say so.
    const timer = window.setTimeout(() => {
      if (seq !== joinSeqRef.current) return;
      if (everJoinedRef.current) {
        if (socket.connected) rejoinRef.current();
        return;
      }
      setStatus('error');
      setError('timeout');
    }, 12_000);
    socket.emit(
      WS_EVENTS.rtcJoin,
      { sessionId: sid, media: mediaRef.current, clientId: tabClientId() },
      (ack: RtcJoinAck) => {
        void (async () => {
          if (seq !== joinSeqRef.current || !wantJoinedRef.current) return;
          window.clearTimeout(timer);
          if (!ack?.ok || !ack.selfId) {
            if (everJoinedRef.current && ack?.error === 'media_unavailable') {
              window.setTimeout(() => rejoinRef.current(), 3_000);
              return;
            }
            setStatus('error');
            setError(ack?.error ?? 'join_failed');
            return;
          }
          // Apply the roster snapshot NOW, before anything async: from this
          // moment the server sends peer/producer events for this room, and
          // a snapshot applied later would overwrite them (lost people).
          const roster = (ack.peers ?? []).map((p) => ({
            ...p,
            camera: null,
            screen: null,
          }));
          selfIdRef.current = ack.selfId;
          callIdRef.current = ack.startedAt ?? null;
          peersRef.current = roster;
          setSelfId(ack.selfId);
          setRole(ack.role ?? 'participant');
          setPeers(roster);
          for (const info of ack.producers ?? []) {
            knownRef.current.set(info.producerId, info);
          }
          try {
            const device = new Device();
            await device.load({
              routerRtpCapabilities:
                ack.routerRtpCapabilities as msc.RtpCapabilities,
            });
            if (seq !== joinSeqRef.current) return;
            deviceRef.current = device;
            recvRef.current = await createTransport('recv');
            if (seq !== joinSeqRef.current) return;
            everJoinedRef.current = true;
            setError(null);
            setStatus('joined');
            saveResume();
            syncConsumers();
            // (Re)publish whatever is on locally.
            const t = tracksRef.current;
            const m = mediaRef.current;
            const live = (x?: MediaStreamTrack) => !!x && x.readyState === 'live';
            if (live(t.mic)) {
              await publish('mic', t.mic!);
              if (!m.audio) {
                const p = producersRef.current.get('mic');
                p?.pause();
                if (p) {
                  socket.emit(WS_EVENTS.rtcProducerPause, {
                    producerId: p.id,
                    paused: true,
                  });
                }
              }
            }
            if (m.video && live(t.camera)) await publish('camera', t.camera!);
            if (m.screen && live(t.screen)) {
              await publish('screen', t.screen!);
              if (live(t['screen-audio'])) {
                await publish('screen-audio', t['screen-audio']!);
              }
            }
          } catch (err) {
            console.warn('[video] join failed', err);
            if (seq !== joinSeqRef.current) return;
            if (everJoinedRef.current) {
              window.setTimeout(() => rejoinRef.current(), 2_000);
            } else {
              setStatus('error');
              setError('join_failed');
            }
          }
        })();
      },
    );
  }, [createTransport, publish, saveResume, syncConsumers, teardown]);

  rejoinRef.current = () => {
    if (!wantJoinedRef.current) return;
    if (socketRef.current?.connected) doJoin();
    else setStatus('reconnecting');
  };

  const leaveInternal = useCallback(
    (opts: { keepResume?: boolean } = {}) => {
      wantJoinedRef.current = false;
      everJoinedRef.current = false;
      joinSeqRef.current++;
      const sid = sessionIdRef.current;
      if (sid) socketRef.current?.emit(WS_EVENTS.rtcLeave, { sessionId: sid });
      if (!opts.keepResume) writeCallResume(sid, null);
      teardown();
      stopLocal();
      mediaRef.current = NO_MEDIA;
      setMedia(NO_MEDIA);
      setPeers([]);
      setSpeaking([]);
      setDominantId(null);
      lastSpokeRef.current.clear();
      stageRef.current = null;
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
      selfIdRef.current = null;
      setSelfId(null);
      setRole(null);
      setStatus('idle');
    },
    [stopLocal, teardown],
  );

  const leave = useCallback(() => leaveInternal(), [leaveInternal]);

  const ensureSocket = useCallback((): LiveSocket | null => {
    if (socketRef.current) return socketRef.current;
    const auth = tokenRef.current;
    if (!auth) return null;
    const socket: LiveSocket = io(resolveLiveSocketUrl(), {
      transports: LIVE_SOCKET_TRANSPORTS,
      auth: { token: auth },
      query: { token: auth },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4_000,
      timeout: 12_000,
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // First connect, or a new socket after a drop → (re)build everything.
      if (wantJoinedRef.current) doJoin();
    });
    socket.on('disconnect', () => {
      if (wantJoinedRef.current && everJoinedRef.current) setStatus('reconnecting');
    });
    socket.on('connect_error', (err) => {
      if (!wantJoinedRef.current) return;
      if (everJoinedRef.current) {
        setStatus('reconnecting'); // socket.io keeps retrying
        return;
      }
      setStatus('error');
      setError(err.message);
    });

    socket.on(WS_EVENTS.rtcPeerJoined, (peer) => {
      setPeers((prev) => {
        const old = prev.find((p) => p.peerId === peer.peerId);
        const next: RemotePeer = { ...peer, camera: null, screen: null };
        return old
          ? prev.map((p) => (p.peerId === peer.peerId ? next : p))
          : [...prev, next];
      });
    });
    socket.on(WS_EVENTS.rtcPeerLeft, ({ peerId }) => {
      for (const [id, info] of knownRef.current) {
        if (info.peerId !== peerId) continue;
        knownRef.current.delete(id);
        const entry = consumersRef.current.get(id);
        if (entry && !entry.consumer.closed) entry.consumer.close();
        consumersRef.current.delete(id);
      }
      lastSpokeRef.current.delete(peerId);
      setPeers((prev) => prev.filter((p) => p.peerId !== peerId));
      setDominantId((cur) => (cur === peerId ? null : cur));
      syncConsumers();
    });
    socket.on(WS_EVENTS.rtcPeerState, ({ peerId, media: m }) => {
      setPeers((prev) => prev.map((p) => (p.peerId === peerId ? { ...p, media: m } : p)));
    });
    socket.on(WS_EVENTS.rtcProducerNew, (info) => {
      if (info.peerId === selfIdRef.current) return;
      knownRef.current.set(info.producerId, info);
      syncConsumers();
    });
    socket.on(WS_EVENTS.rtcProducerClosed, ({ producerId, peerId }) => {
      knownRef.current.delete(producerId);
      const entry = consumersRef.current.get(producerId);
      if (entry) {
        if (!entry.consumer.closed) entry.consumer.close();
        consumersRef.current.delete(producerId);
        rebuildStreams(peerId);
      }
      syncConsumers();
    });
    socket.on(WS_EVENTS.rtcSpeakers, ({ speakers }) => {
      const now = Date.now();
      const ids = speakers.map((s) => s.peerId);
      for (const id of ids) lastSpokeRef.current.set(id, now);
      setSpeaking((prev) =>
        prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
      );
      // The floor goes to the loudest OTHER person; it stays with them
      // through pauses, so the stage does not jump around.
      const loudest = ids.find((id) => id !== selfIdRef.current);
      if (loudest) setDominantId((cur) => (cur === loudest ? cur : loudest));
    });
    socket.on(WS_EVENTS.rtcModerate, ({ action }) => {
      setModeratedAt({ action, at: Date.now() });
      const cur = mediaRef.current;
      if (action === 'mute' && cur.audio) {
        const p = producersRef.current.get('mic');
        if (p && !p.closed) {
          p.pause();
          socket.emit(WS_EVENTS.rtcProducerPause, { producerId: p.id, paused: true });
        }
        publishState({ ...cur, audio: false });
      } else if (action === 'stop-video' && cur.video) {
        tracksRef.current.camera?.stop();
        unpublish('camera');
        setLocalCamera(null);
        publishState({ ...cur, video: false });
      } else if (action === 'lower-hand' && cur.hand) {
        publishState({ ...cur, hand: false });
      }
    });
    socket.on(WS_EVENTS.rtcCallEnded, () => {
      if (!wantJoinedRef.current) return;
      setEndedAt(Date.now());
      leaveInternal();
    });
    socket.on(WS_EVENTS.rtcReset, () => {
      if (wantJoinedRef.current) doJoin();
    });
    return socket;
  }, [doJoin, leaveInternal, publishState, rebuildStreams, syncConsumers, unpublish]);

  // Leave on unmount / session change — but remember the call, so a reload
  // (where this cleanup may or may not run) brings the person straight back.
  useEffect(
    () => () => leaveInternal({ keepResume: true }),
    [sessionId, leaveInternal],
  );

  // Back online / tab visible again → make sure we are still connected.
  useEffect(() => {
    const check = () => {
      if (!wantJoinedRef.current) return;
      const socket = socketRef.current;
      if (socket && !socket.connected) socket.connect();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ── local media ──────────────────────────────────────────────────────────

  const refreshLocalCamera = useCallback(() => {
    const t = tracksRef.current;
    const tracks = [t.camera, t.mic].filter(
      (x): x is MediaStreamTrack => !!x && x.readyState === 'live',
    );
    setLocalCamera(tracks.length ? new MediaStream(tracks) : null);
  }, []);

  const enableAudio = useCallback(async (): Promise<boolean> => {
    const existing = tracksRef.current.mic;
    if (existing && existing.readyState === 'live') {
      existing.enabled = true;
      await publish('mic', existing);
      return true;
    }
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const track = s.getAudioTracks()[0];
    if (!track) return false;
    await publish('mic', track);
    refreshLocalCamera();
    return true;
  }, [publish, refreshLocalCamera]);

  const enableVideo = useCallback(async (): Promise<boolean> => {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 24, max: 24 },
      },
    });
    const track = s.getVideoTracks()[0];
    if (!track) return false;
    tracksRef.current.camera?.stop();
    await publish('camera', track);
    refreshLocalCamera();
    return true;
  }, [publish, refreshLocalCamera]);

  const join = useCallback(
    async (opts: { audio?: boolean; video?: boolean } = {}) => {
      if (!sessionIdRef.current || wantJoinedRef.current) return;
      setError(null);
      setEndedAt(null);
      wantJoinedRef.current = true;
      setStatus('joining');
      let next: RtcMediaState = { ...NO_MEDIA };
      try {
        // Tracks are captured first and sent once the room is joined.
        if (opts.audio && (await enableAudio())) next = { ...next, audio: true };
        if (opts.video && (await enableVideo())) next = { ...next, video: true };
      } catch {
        setError('media_denied');
      }
      if (!wantJoinedRef.current) return; // left while the prompt was open
      mediaRef.current = next;
      setMedia(next);
      const socket = ensureSocket();
      if (!socket) {
        wantJoinedRef.current = false;
        setStatus('error');
        setError('no_token');
        return;
      }
      if (socket.connected) doJoin();
    },
    [doJoin, enableAudio, enableVideo, ensureSocket],
  );

  const endCall = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) socketRef.current?.emit(WS_EVENTS.rtcCallEnd, { sessionId: sid });
  }, []);

  const setRecording = useCallback((on: boolean) => {
    const sid = sessionIdRef.current;
    if (sid) socketRef.current?.emit(WS_EVENTS.rtcRecording, { sessionId: sid, on });
  }, []);

  const toggleAudio = useCallback(async () => {
    const cur = mediaRef.current;
    if (cur.audio) {
      const p = producersRef.current.get('mic');
      if (p && !p.closed) {
        p.pause();
        socketRef.current?.emit(WS_EVENTS.rtcProducerPause, {
          producerId: p.id,
          paused: true,
        });
      } else if (tracksRef.current.mic) {
        tracksRef.current.mic.enabled = false;
      }
      publishState({ ...cur, audio: false });
      return;
    }
    try {
      if (!(await enableAudio())) return;
      publishState({ ...mediaRef.current, audio: true });
    } catch {
      setError('media_denied');
    }
  }, [enableAudio, publishState]);

  const toggleVideo = useCallback(async () => {
    const cur = mediaRef.current;
    if (cur.video) {
      tracksRef.current.camera?.stop();
      unpublish('camera');
      refreshLocalCamera();
      publishState({ ...cur, video: false });
      return;
    }
    try {
      if (!(await enableVideo())) return;
      publishState({ ...mediaRef.current, video: true });
    } catch {
      setError('media_denied');
    }
  }, [enableVideo, publishState, refreshLocalCamera, unpublish]);

  const stopScreen = useCallback(() => {
    tracksRef.current.screen?.stop();
    tracksRef.current['screen-audio']?.stop();
    unpublish('screen');
    unpublish('screen-audio');
    setLocalScreen(null);
    publishState({ ...mediaRef.current, screen: false });
  }, [publishState, unpublish]);

  const toggleScreen = useCallback(async () => {
    if (mediaRef.current.screen) {
      stopScreen();
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 20 },
          width: { max: 1920 },
          height: { max: 1080 },
        },
        audio: true,
      });
      const track = s.getVideoTracks()[0];
      if (!track) return;
      if ('contentHint' in track) track.contentHint = 'detail';
      track.onended = () => stopScreen();
      setLocalScreen(new MediaStream([track]));
      publishState({ ...mediaRef.current, screen: true });
      await publish('screen', track);
      const audio = s.getAudioTracks()[0];
      if (audio) await publish('screen-audio', audio);
    } catch {
      /* user cancelled the picker */
    }
  }, [publish, publishState, stopScreen]);

  const toggleHand = useCallback(() => {
    publishState({ ...mediaRef.current, hand: !mediaRef.current.hand });
  }, [publishState]);

  const moderate = useCallback((target: string, action: RtcModerateAction) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    socketRef.current?.emit(WS_EVENTS.rtcModerate, { sessionId: sid, target, action });
  }, []);

  const setStage = useCallback(
    (peerId: string | null) => {
      const prev = stageRef.current;
      if (prev === peerId) return;
      stageRef.current = peerId;
      for (const [producerId, info] of knownRef.current) {
        if (info.source !== 'camera') continue;
        if (info.peerId === prev) setLayer(producerId, 0);
        if (info.peerId === peerId) setLayer(producerId, 2);
      }
      syncConsumers();
    },
    [setLayer, syncConsumers],
  );

  return {
    status,
    error,
    selfId,
    role,
    peers,
    media,
    localCamera,
    localScreen,
    speaking,
    dominantId,
    join,
    leave,
    endCall,
    setRecording,
    toggleAudio,
    toggleVideo,
    toggleScreen,
    toggleHand,
    moderate,
    setStage,
    moderatedAt,
    endedAt,
  };
}
