import { WS_NAMESPACE } from '@lms/shared';

/** Where the Socket.IO client connects: `io(url, { path })`. */
export interface LiveSocketTarget {
  /** Origin + namespace, e.g. `https://airl.kz/live`. */
  url: string;
  /** Engine.IO path on that origin, e.g. `/lms-api/socket.io`. */
  path: string;
}

/**
 * Address of the realtime `/live` namespace.
 *
 * NEXT_PUBLIC_WS_URL is the public address of the API, with or without the
 * namespace at the end:
 *   - `wss://lms-api.example.kz` — the API has a host of its own;
 *   - `wss://airl.kz/lms-api`    — the API is served under a path of the site
 *     (the reverse proxy strips `/lms-api`, the API still sees `/socket.io`).
 *
 * Socket.IO reads the path of the URL it is given as the *namespace*, so a
 * path prefix cannot stay in the URL — the client would ask for the namespace
 * `/lms-api/live`, which nothing answers. The prefix is split off here and
 * returned as the Engine.IO `path` instead; the namespace is always appended,
 * because without it the client silently lands in the default namespace,
 * where no handler answers either. ws(s) is mapped to http(s); the client
 * upgrades to WebSocket itself.
 */
export function resolveLiveSocket(): LiveSocketTarget {
  const raw = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';
  let base = raw
    .trim()
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:')
    .replace(/\/+$/, '');
  if (base.endsWith(WS_NAMESPACE)) {
    base = base.slice(0, -WS_NAMESPACE.length).replace(/\/+$/, '');
  }
  const match = /^(https?:\/\/[^/]+)(\/.*)?$/i.exec(base);
  const origin = match ? match[1] : base;
  const prefix = match?.[2] ?? '';
  return { url: `${origin}${WS_NAMESPACE}`, path: `${prefix}/socket.io` };
}

/**
 * Start on HTTP long-polling, then upgrade to WebSocket when the proxy
 * allows it — works behind any reverse proxy, fast where upgrades pass.
 */
export const LIVE_SOCKET_TRANSPORTS = ['polling', 'websocket'];
