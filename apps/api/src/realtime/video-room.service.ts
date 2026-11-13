import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { cpus } from 'os';
import * as mediasoup from 'mediasoup';
import type { types as ms } from 'mediasoup';
import type {
  RtcMediaState,
  RtcPeer,
  RtcProducerInfo,
  RtcSource,
} from '@lms/shared';

/** How long a running call may stay empty before it is ended. */
const EMPTY_CALL_GRACE_MS = Number(process.env.RTC_EMPTY_CALL_GRACE_MS ?? 120_000);

/** Hard cap on people in one video room. */
export const VIDEO_ROOM_MAX_PEERS = Number(process.env.RTC_MAX_PEERS ?? 150);

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
  return {
    ...EMPTY_MEDIA,
    audio: m.audio === true,
    video: m.video === true,
    screen: m.screen === true,
    hand: m.hand === true,
  };
}

const SOURCES: readonly RtcSource[] = ['mic', 'camera', 'screen', 'screen-audio'];
export function isRtcSource(v: unknown): v is RtcSource {
  return typeof v === 'string' && (SOURCES as readonly string[]).includes(v);
}

const MEDIA_CODECS: ms.RouterRtpCodecCapability[] = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 800 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 800,
    },
  },
];

interface SfuWorker {
  worker: ms.Worker;
  server: ms.WebRtcServer;
}

interface SfuPeer {
  info: RtcPeer;
  sessionId: string;
  socketId: string;
  transports: Map<string, ms.WebRtcTransport>;
  producers: Map<string, ms.Producer>;
  consumers: Map<string, ms.Consumer>;
}

interface SfuRoom {
  sessionId: string;
  router: ms.Router;
  audioLevels: ms.AudioLevelObserver;
  peers: Map<string, SfuPeer>;
  /** ISO time the running call started; null = no call. */
  startedAt: string | null;
}

export interface SpeakerLevel {
  peerId: string;
  volume: number;
}

/**
 * Video rooms on a server-side SFU (mediasoup).
 *
 * Every participant sends each track ONCE to this server, which forwards it
 * to the others — so a 50+ person class costs the teacher one upload instead
 * of one per student (the previous browser-to-browser mesh). Simulcast lets
 * the server hand weak connections a lower layer.
 *
 * All media uses one UDP+TCP port per worker (RTC_PORT, RTC_PORT+1, …) with
 * RTC_ANNOUNCED_IP as the public address, so the firewall needs only those.
 *
 * State is in memory: the API runs as a single instance. A call's lifetime is
 * explicit (`startedAt`), NOT tied to the host's socket — a host reload or a
 * network blip no longer ends the call for everybody.
 */
@Injectable()
export class VideoRoomService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoRoomService.name);
  private workers: SfuWorker[] = [];
  private nextWorker = 0;
  private readonly rooms = new Map<string, SfuRoom>();
  /** socket id → peer (one video room per socket). */
  private readonly bySocket = new Map<string, SfuPeer>();
  private closing = false;

  /** Set by the gateway: loudest speakers of a session changed. */
  onSpeakers: (sessionId: string, speakers: SpeakerLevel[]) => void = () => undefined;
  /** Set by the gateway: a running call stayed empty — end it. */
  onIdle: (sessionId: string) => void = () => undefined;
  /** Set by the gateway: a media worker died; its rooms were dropped. */
  onReset: (sessionIds: string[]) => void = () => undefined;

  async onModuleInit(): Promise<void> {
    const count = Math.max(
      1,
      Math.min(Number(process.env.RTC_WORKERS ?? 2), cpus().length),
    );
    for (let i = 0; i < count; i++) {
      try {
        this.workers.push(await this.startWorker(i));
      } catch (err) {
        this.logger.error(
          `media worker ${i} failed to start: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(
      `SFU ready: ${this.workers.length} worker(s), ports ${this.basePort()}–${this.basePort() + count - 1}, announced ${this.announcedIp() ?? '(none)'}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    for (const w of this.workers) w.worker.close();
    this.workers = [];
  }

  private basePort(): number {
    return Number(process.env.RTC_PORT ?? 44444);
  }

  private announcedIp(): string | undefined {
    return process.env.RTC_ANNOUNCED_IP || undefined;
  }

  private async startWorker(index: number): Promise<SfuWorker> {
    const worker = await mediasoup.createWorker({ logLevel: 'warn' });
    const port = this.basePort() + index;
    const announcedAddress = this.announcedIp();
    const listen = (protocol: 'udp' | 'tcp'): ms.TransportListenInfo => ({
      protocol,
      ip: '0.0.0.0',
      port,
      ...(announcedAddress ? { announcedAddress } : {}),
    });
    const server = await worker.createWebRtcServer({
      listenInfos: [listen('udp'), listen('tcp')],
    });
    worker.on('died', () => {
      if (this.closing) return;
      this.logger.error(`media worker ${index} died — restarting`);
      const dead = [...this.rooms.values()].filter((r) => r.router.closed);
      const ids: string[] = [];
      for (const room of dead) {
        // Keep the call "running" so clients come straight back.
        ids.push(room.sessionId);
        for (const peer of room.peers.values()) this.bySocket.delete(peer.socketId);
        this.rooms.delete(room.sessionId);
        this.resumeAt.set(room.sessionId, room.startedAt);
      }
      void this.startWorker(index)
        .then((w) => {
          this.workers[index] = w;
          this.onReset(ids);
        })
        .catch((err) =>
          this.logger.error(`media worker ${index} restart failed: ${String(err)}`),
        );
    });
    return { worker, server };
  }

  /** startedAt of calls whose room was lost with a worker (restored on rejoin). */
  private readonly resumeAt = new Map<string, string | null>();

  private async room(sessionId: string): Promise<SfuRoom> {
    const existing = this.rooms.get(sessionId);
    if (existing) return existing;
    if (this.workers.length === 0) throw new Error('media_unavailable');
    const w = this.workers[this.nextWorker++ % this.workers.length]!;
    const router = await w.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
    // A concurrent join may have created the room while we awaited.
    const raced = this.rooms.get(sessionId);
    if (raced) {
      router.close();
      return raced;
    }
    const audioLevels = await router.createAudioLevelObserver({
      maxEntries: 4,
      threshold: -58,
      interval: 350,
    });
    const room: SfuRoom = {
      sessionId,
      router,
      audioLevels,
      peers: new Map(),
      startedAt: this.resumeAt.get(sessionId) ?? null,
    };
    this.resumeAt.delete(sessionId);
    // Tag each transport with its WebRtcServer through the router's worker.
    (router.appData as { server?: ms.WebRtcServer }).server = w.server;
    audioLevels.on('volumes', (volumes) => {
      const speakers: SpeakerLevel[] = [];
      for (const v of volumes) {
        const peerId = (v.producer.appData as { peerId?: string }).peerId;
        if (peerId) speakers.push({ peerId, volume: v.volume });
      }
      this.onSpeakers(sessionId, speakers);
    });
    audioLevels.on('silence', () => this.onSpeakers(sessionId, []));
    this.rooms.set(sessionId, room);
    return room;
  }

  // ── roster ───────────────────────────────────────────────────────────────

  state(sessionId: string): { active: boolean; count: number; startedAt: string | null } {
    const room = this.rooms.get(sessionId);
    const startedAt = room?.startedAt ?? this.resumeAt.get(sessionId) ?? null;
    return { active: startedAt != null, count: room?.peers.size ?? 0, startedAt };
  }

  peers(sessionId: string): RtcPeer[] {
    return [...(this.rooms.get(sessionId)?.peers.values() ?? [])].map((p) => p.info);
  }

  size(sessionId: string): number {
    return this.rooms.get(sessionId)?.peers.size ?? 0;
  }

  peerOfSocket(socketId: string): SfuPeer | undefined {
    return this.bySocket.get(socketId);
  }

  peer(sessionId: string, peerId: string): SfuPeer | undefined {
    return this.rooms.get(sessionId)?.peers.get(peerId);
  }

  producers(sessionId: string, exceptPeerId?: string): RtcProducerInfo[] {
    const out: RtcProducerInfo[] = [];
    for (const peer of this.rooms.get(sessionId)?.peers.values() ?? []) {
      if (peer.info.peerId === exceptPeerId) continue;
      for (const p of peer.producers.values()) out.push(this.producerInfo(peer, p));
    }
    return out;
  }

  private producerInfo(peer: SfuPeer, p: ms.Producer): RtcProducerInfo {
    return {
      producerId: p.id,
      peerId: peer.info.peerId,
      kind: p.kind,
      source: (p.appData as { source: RtcSource }).source,
      paused: p.paused,
    };
  }

  /**
   * Add a peer. A peer with the same id (same tab coming back after a reload
   * or reconnect) is replaced; returns the socket id of the replaced entry.
   * A host entering starts the call if none is running.
   */
  async add(
    sessionId: string,
    socketId: string,
    info: RtcPeer,
  ): Promise<{ room: SfuRoom; replacedSocketId: string | null; started: boolean }> {
    const room = await this.room(sessionId);
    const old = room.peers.get(info.peerId);
    let replacedSocketId: string | null = null;
    if (old) {
      replacedSocketId = old.socketId;
      this.closePeer(old);
    }
    const peer: SfuPeer = {
      info,
      sessionId,
      socketId,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    room.peers.set(info.peerId, peer);
    this.bySocket.set(socketId, peer);
    let started = false;
    if (info.role === 'host' && room.startedAt == null) {
      room.startedAt = new Date().toISOString();
      started = true;
    }
    return { room, replacedSocketId, started };
  }

  routerCapabilities(sessionId: string): ms.RtpCapabilities | undefined {
    return this.rooms.get(sessionId)?.router.rtpCapabilities;
  }

  setMedia(peer: SfuPeer, media: RtcMediaState): void {
    peer.info.media = media;
  }

  private closePeer(peer: SfuPeer): void {
    for (const t of peer.transports.values()) t.close();
    peer.transports.clear();
    peer.producers.clear();
    peer.consumers.clear();
    this.bySocket.delete(peer.socketId);
  }

  /** Remove the peer bound to a socket; returns it (for broadcasts). */
  removeSocket(socketId: string): SfuPeer | undefined {
    const peer = this.bySocket.get(socketId);
    if (!peer) return undefined;
    this.closePeer(peer);
    const room = this.rooms.get(peer.sessionId);
    // Only drop the roster entry if it still belongs to this socket.
    if (room?.peers.get(peer.info.peerId) === peer) room.peers.delete(peer.info.peerId);
    this.gc(peer.sessionId);
    return peer;
  }

  /**
   * An empty room with no running call frees its router at once. A running
   * call that everybody left (nobody pressed «end») is ended after a grace
   * period, so reloads and short drops of the last person do not end it.
   */
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private gc(sessionId: string): void {
    const room = this.rooms.get(sessionId);
    if (!room || room.peers.size > 0) return;
    if (room.startedAt == null) {
      room.router.close();
      this.rooms.delete(sessionId);
      return;
    }
    if (this.idleTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.idleTimers.delete(sessionId);
      const current = this.rooms.get(sessionId);
      if (current && current.peers.size === 0) this.onIdle(sessionId);
    }, EMPTY_CALL_GRACE_MS);
    timer.unref?.();
    this.idleTimers.set(sessionId, timer);
  }

  /** End the call: drop everyone and the router. Returns removed peer ids. */
  close(sessionId: string): string[] {
    this.resumeAt.delete(sessionId);
    const idle = this.idleTimers.get(sessionId);
    if (idle) clearTimeout(idle);
    this.idleTimers.delete(sessionId);
    const room = this.rooms.get(sessionId);
    if (!room) return [];
    const ids = [...room.peers.keys()];
    for (const peer of room.peers.values()) this.closePeer(peer);
    room.router.close();
    this.rooms.delete(sessionId);
    return ids;
  }

  // ── transports / producers / consumers ───────────────────────────────────

  async createTransport(peer: SfuPeer): Promise<{
    id: string;
    iceParameters: ms.IceParameters;
    iceCandidates: ms.IceCandidate[];
    dtlsParameters: ms.DtlsParameters;
  }> {
    const room = this.rooms.get(peer.sessionId);
    if (!room) throw new Error('no_room');
    if (peer.transports.size >= 4) throw new Error('too_many_transports');
    const server = (room.router.appData as { server?: ms.WebRtcServer }).server;
    if (!server) throw new Error('media_unavailable');
    const transport = await room.router.createWebRtcTransport({
      webRtcServer: server,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1_000_000,
    });
    peer.transports.set(transport.id, transport);
    transport.observer.on('close', () => peer.transports.delete(transport.id));
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(peer: SfuPeer, transportId: string, dtlsParameters: unknown): Promise<void> {
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('no_transport');
    await transport.connect({ dtlsParameters: dtlsParameters as ms.DtlsParameters });
  }

  async restartIce(peer: SfuPeer, transportId: string): Promise<ms.IceParameters> {
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('no_transport');
    return transport.restartIce();
  }

  async produce(
    peer: SfuPeer,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: unknown,
    source: RtcSource,
  ): Promise<RtcProducerInfo> {
    const transport = peer.transports.get(transportId);
    const room = this.rooms.get(peer.sessionId);
    if (!transport || !room) throw new Error('no_transport');
    // One producer per source: a new one replaces the old.
    for (const old of [...peer.producers.values()]) {
      if ((old.appData as { source: RtcSource }).source === source) old.close();
    }
    const producer = await transport.produce({
      kind,
      rtpParameters: rtpParameters as ms.RtpParameters,
      appData: { peerId: peer.info.peerId, source },
    });
    peer.producers.set(producer.id, producer);
    producer.observer.on('close', () => peer.producers.delete(producer.id));
    if (source === 'mic') {
      await room.audioLevels.addProducer({ producerId: producer.id }).catch(() => undefined);
    }
    return this.producerInfo(peer, producer);
  }

  closeProducer(peer: SfuPeer, producerId: string): boolean {
    const producer = peer.producers.get(producerId);
    if (!producer) return false;
    producer.close();
    return true;
  }

  async pauseProducer(peer: SfuPeer, producerId: string, paused: boolean): Promise<boolean> {
    const producer = peer.producers.get(producerId);
    if (!producer) return false;
    if (paused) await producer.pause();
    else await producer.resume();
    return true;
  }

  /** Find a producer in the peer's room (owner + producer). */
  private findProducer(sessionId: string, producerId: string): ms.Producer | undefined {
    for (const p of this.rooms.get(sessionId)?.peers.values() ?? []) {
      const producer = p.producers.get(producerId);
      if (producer) return producer;
    }
    return undefined;
  }

  async consume(
    peer: SfuPeer,
    producerId: string,
    rtpCapabilities: unknown,
    onProducerGone: (consumerId: string) => void,
  ): Promise<{ id: string; producerId: string; kind: ms.MediaKind; rtpParameters: ms.RtpParameters }> {
    const room = this.rooms.get(peer.sessionId);
    if (!room) throw new Error('no_room');
    const producer = this.findProducer(peer.sessionId, producerId);
    if (!producer || peer.producers.has(producerId)) throw new Error('no_producer');
    const caps = rtpCapabilities as ms.RtpCapabilities;
    if (!room.router.canConsume({ producerId, rtpCapabilities: caps })) {
      throw new Error('cannot_consume');
    }
    // Any transport that is not used for producing serves as the recv side.
    const transport = [...peer.transports.values()].find(
      (t) => (t.appData as { direction?: string }).direction === 'recv',
    );
    if (!transport) throw new Error('no_transport');
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: caps,
      // Start paused; the client resumes once its <video>/<audio> is wired.
      paused: true,
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.observer.on('close', () => peer.consumers.delete(consumer.id));
    consumer.on('producerclose', () => {
      consumer.close();
      onProducerGone(consumer.id);
    });
    if (consumer.type === 'simulcast') {
      // Thumbnails by default; the stage asks for the best layer.
      await consumer.setPreferredLayers({ spatialLayer: 0 }).catch(() => undefined);
    }
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async pauseConsumer(peer: SfuPeer, consumerId: string, paused: boolean): Promise<boolean> {
    const consumer = peer.consumers.get(consumerId);
    if (!consumer) return false;
    if (paused) await consumer.pause();
    else await consumer.resume();
    return true;
  }

  async setConsumerLayer(peer: SfuPeer, consumerId: string, spatialLayer: number): Promise<void> {
    const consumer = peer.consumers.get(consumerId);
    if (!consumer || consumer.type !== 'simulcast') return;
    const layer = Math.max(0, Math.min(2, Math.floor(spatialLayer)));
    await consumer.setPreferredLayers({ spatialLayer: layer }).catch(() => undefined);
  }

  /** Mark a transport's direction (set right after creation). */
  tagTransport(peer: SfuPeer, transportId: string, direction: 'send' | 'recv'): void {
    const t = peer.transports.get(transportId);
    if (t) (t.appData as { direction?: string }).direction = direction;
  }
}

export type { SfuPeer };
