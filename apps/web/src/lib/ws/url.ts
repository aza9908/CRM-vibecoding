import { WS_NAMESPACE } from '@lms/shared';

/**
 * Socket.IO URL of the realtime `/live` namespace.
 *
 * NEXT_PUBLIC_WS_URL may be configured with or without the namespace
 * (e.g. `wss://lms-api.magauin.kz` vs `wss://…/live`). Without it the client
 * silently lands in the default namespace, where no handler answers — so
 * the namespace is always appended here. ws(s) is mapped to http(s); the
 * client upgrades to WebSocket itself.
 */
export function resolveLiveSocketUrl(): string {
  const raw = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';
  const base = raw
    .trim()
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:')
    .replace(/\/+$/, '');
  return base.endsWith(WS_NAMESPACE) ? base : `${base}${WS_NAMESPACE}`;
}

/**
 * Start on HTTP long-polling, then upgrade to WebSocket when the proxy
 * allows it — works behind any reverse proxy, fast where upgrades pass.
 */
export const LIVE_SOCKET_TRANSPORTS = ['polling', 'websocket'];
