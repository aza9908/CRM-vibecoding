import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import type { RtcIceServer, RtcMediaState, RtcPeer } from '@lms/shared';

/** Hard cap on people in one video room — the mesh is browser-to-browser. */
export const VIDEO_ROOM_MAX_PEERS = Number(process.env.RTC_MAX_PEERS ?? 40);
/** Max size of one relayed SDP/ICE message (an SDP is a few KB). */
export const RTC_SIGNAL_MAX_BYTES = 64 * 1024;

const TURN_TTL_SECONDS = 12 * 3600;

const EMPTY_MEDIA: RtcMediaState = {
  audio: false,
  video: false,
  screen: false,
  hand: false,
  cameraStreamId: null,
  screenStreamId: null,
};

/** Coerce a client-supplied media state into a safe, well-typed object. */
export function sanitizeMedia(raw: unknown): RtcMediaState {
  const m = (raw ?? {}) as Partial<Record<keyof RtcMediaState, unknown>>;
  const streamId = (v: unknown): string | null =>
    typeof v === 'string' && /^[\w{}-]{1,64}$/.test(v) ? v : null;
  return {
    ...EMPTY_MEDIA,
    audio: m.audio === true,
    video: m.video === true,
    screen: m.screen === true,
    hand: m.hand === true,
    cameraStreamId: streamId(m.cameraStreamId),
    screenStreamId: streamId(m.screenStreamId),
  };
}

/**
 * In-memory roster of the per-session video rooms.
 *
 * Media never touches the server: browsers connect peer-to-peer (WebRTC) and
 * this service only tracks who is in which room so the gateway can relay
 * SDP/ICE between members of the same session. Like the chat buffer, the
 * roster is per API instance — the API runs as a single instance
 * (apphosting.yaml maxInstances: 1 / one container on the VPS).
 */
@Injectable()
export class VideoRoomService {
  /** sessionId → (peerId → peer) */
  private readonly rooms = new Map<string, Map<string, RtcPeer>>();
  /** peerId (socket id) → sessionId — one video room per socket. */
  private readonly peerSession = new Map<string, string>();

  peers(sessionId: string): RtcPeer[] {
    return [...(this.rooms.get(sessionId)?.values() ?? [])];
  }

  get(sessionId: string, peerId: string): RtcPeer | undefined {
    return this.rooms.get(sessionId)?.get(peerId);
  }

  sessionOf(peerId: string): string | undefined {
    return this.peerSession.get(peerId);
  }

  size(sessionId: string): number {
    return this.rooms.get(sessionId)?.size ?? 0;
  }

  add(sessionId: string, peer: RtcPeer): void {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = new Map();
      this.rooms.set(sessionId, room);
    }
    room.set(peer.peerId, peer);
    this.peerSession.set(peer.peerId, sessionId);
  }

  setMedia(sessionId: string, peerId: string, media: RtcMediaState): boolean {
    const peer = this.rooms.get(sessionId)?.get(peerId);
    if (!peer) return false;
    peer.media = media;
    return true;
  }

  /** Remove a peer; returns the sessionId it was in (if any). */
  remove(peerId: string): string | undefined {
    const sessionId = this.peerSession.get(peerId);
    if (!sessionId) return undefined;
    this.peerSession.delete(peerId);
    const room = this.rooms.get(sessionId);
    room?.delete(peerId);
    if (room && room.size === 0) this.rooms.delete(sessionId);
    return sessionId;
  }

  /** Drop a whole room (session ended). Returns the removed peer ids. */
  close(sessionId: string): string[] {
    const ids = [...(this.rooms.get(sessionId)?.keys() ?? [])];
    for (const id of ids) this.peerSession.delete(id);
    this.rooms.delete(sessionId);
    return ids;
  }

  /**
   * ICE servers for a client. STUN is public; TURN (needed behind strict
   * NAT / corporate firewalls) is configured on the server only:
   *   RTC_STUN_URLS   comma-separated, default Google STUN
   *   TURN_URLS       comma-separated turn:/turns: URLs
   *   TURN_SECRET     coturn `static-auth-secret` → short-lived credentials
   *   TURN_USERNAME / TURN_CREDENTIAL  static credentials (if no secret)
   */
  iceServers(userKey: string): RtcIceServer[] {
    const list = (v: string | undefined): string[] =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const stun = list(
      process.env.RTC_STUN_URLS ??
        'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302',
    );
    const servers: RtcIceServer[] = stun.length ? [{ urls: stun }] : [];

    const turn = list(process.env.TURN_URLS);
    if (turn.length) {
      const secret = process.env.TURN_SECRET;
      if (secret) {
        const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
        const username = `${expiry}:${userKey}`;
        const credential = createHmac('sha1', secret)
          .update(username)
          .digest('base64');
        servers.push({ urls: turn, username, credential });
      } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
        servers.push({
          urls: turn,
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL,
        });
      }
    }
    return servers;
  }
}
