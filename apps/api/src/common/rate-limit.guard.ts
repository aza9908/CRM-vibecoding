import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

/**
 * Request rate limits, enforced before any controller runs.
 *
 * Who a request is counted against:
 *  - a VERIFIED token (user or participant) → that account / participant, so a
 *    class of 60 behind one Wi-Fi address is 60 separate budgets;
 *  - no token or an invalid one → the client IP (taken from the header our
 *    own nginx adds, never from what the client sends).
 *
 * Stricter rules sit on the doors attackers knock on: password guessing,
 * mass sign-ups, password-reset mail, joining by code, the paid AI model.
 * Counters live in memory (one API process); they reset on restart, which is
 * fine for abuse protection.
 */

interface Rule {
  name: string;
  method: string;
  path: RegExp;
  limit: number;
  windowMs: number;
  /** What to count by; null = rule does not apply to this request. */
  by: 'ip' | 'identity' | 'email';
  /** Count only requests that fail (e.g. wrong password); a success clears
   * the account's counter. A class signing in from one Wi-Fi is never
   * blocked for logging in correctly. */
  failuresOnly?: boolean;
}

const MIN = 60_000;
const RULES: Rule[] = [
  // Password guessing: per address and per targeted account.
  { name: 'login-ip', method: 'POST', path: /^\/auth\/login$/, limit: 50, windowMs: 5 * MIN, by: 'ip', failuresOnly: true },
  { name: 'login-email', method: 'POST', path: /^\/auth\/login$/, limit: 10, windowMs: 15 * MIN, by: 'email', failuresOnly: true },
  // Bot sign-ups (a workshop can register a few dozen people from one Wi-Fi).
  { name: 'register-ip', method: 'POST', path: /^\/auth\/register$/, limit: 60, windowMs: 60 * MIN, by: 'ip' },
  // Password-reset mail cannot be used to spam inboxes.
  { name: 'reset-ip', method: 'POST', path: /^\/auth\/(forgot|reset)-password$/, limit: 10, windowMs: 15 * MIN, by: 'ip' },
  { name: 'reset-email', method: 'POST', path: /^\/auth\/forgot-password$/, limit: 3, windowMs: 15 * MIN, by: 'email' },
  // A whole class joins by code from one address at once (60+ people, retries).
  { name: 'join-ip', method: 'POST', path: /^\/sessions\/join$/, limit: 300, windowMs: 5 * MIN, by: 'ip' },
  // The AI model costs money per token: per person, per minute and per day.
  { name: 'ai-minute', method: 'POST', path: /^\/(ai\/chat|lessons\/[^/]+\/blocks\/generate.*)$/, limit: 20, windowMs: MIN, by: 'identity' },
  { name: 'ai-day', method: 'POST', path: /^\/(ai\/chat|lessons\/[^/]+\/blocks\/generate.*)$/, limit: 400, windowMs: 24 * 60 * MIN, by: 'identity' },
  // AI reports («ИИ-анализ ответов», «ИИ-куратор»): each start runs many model calls.
  { name: 'ai-report', method: 'POST', path: /^\/(sessions\/[^/]+\/answers-analysis|curator\/reports)$/, limit: 20, windowMs: 60 * MIN, by: 'identity' },
  // Uploads.
  { name: 'upload', method: 'POST', path: /upload|\/storage/, limit: 60, windowMs: MIN, by: 'identity' },
  // Everything else: a floor against floods, far above what a person does.
  { name: 'any-identity', method: '*', path: /.*/, limit: 1200, windowMs: MIN, by: 'identity' },
];
/** Anonymous traffic shares one budget per address (a class behind NAT logs
 * in / joins from one address, so this is generous). */
const ANON_PER_IP = { limit: 3000, windowMs: MIN };

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly counters = new Map<string, Counter>();
  private readonly secret: string;
  private lastSweep = Date.now();

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('JWT_ACCESS_SECRET') ?? '';
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const path = (req.path || req.url || '').split('?')[0] ?? '';
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') return true;

    const ip = clientIp(req);
    const identity = this.identity(req);
    this.sweep();

    for (const rule of RULES) {
      if (rule.method !== '*' && rule.method !== method) continue;
      if (!rule.path.test(path)) continue;
      let key: string | null = null;
      if (rule.by === 'ip') key = 'ip:' + ip;
      else if (rule.by === 'email') key = emailKey(req);
      else key = identity ? 'id:' + identity : null;
      if (key === null) {
        if (rule.name === 'any-identity') {
          this.hit(res, 'anon', 'ip:' + ip, ANON_PER_IP.limit, ANON_PER_IP.windowMs);
        }
        continue;
      }
      this.hit(res, rule.name, key, rule.limit, rule.windowMs);
      if (rule.failuresOnly) {
        const k = rule.name + '|' + key;
        const byEmail = rule.by === 'email';
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          const c = this.counters.get(k);
          if (!c) return;
          if (byEmail) this.counters.delete(k);
          else c.count = Math.max(0, c.count - 1);
        });
      }
    }
    return true;
  }

  /** Count one hit; throws 429 with Retry-After when over the limit. */
  private hit(res: Response, rule: string, key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const k = rule + '|' + key;
    let c = this.counters.get(k);
    if (!c || c.resetAt <= now) {
      c = { count: 0, resetAt: now + windowMs };
      this.counters.set(k, c);
    }
    c.count += 1;
    if (c.count > limit) {
      const retry = Math.max(1, Math.ceil((c.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      if (c.count === limit + 1) this.logger.warn(`rate limit ${rule} hit by ${key.slice(0, 40)}`);
      throw new HttpException({ message: 'too_many_requests', retryAfter: retry }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** The verified subject of the bearer token, or null. */
  private identity(req: Request): string | null {
    const h = req.headers.authorization;
    const token = h && h.startsWith('Bearer ') ? h.slice(7) : (req.cookies as Record<string, string> | undefined)?.access_token;
    if (!token || !this.secret) return null;
    try {
      const p = this.jwt.verify<{ sub?: string; aud?: string }>(token, { secret: this.secret });
      return p.sub ? `${p.aud ?? 'user'}:${p.sub}` : null;
    } catch {
      return null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < MIN && this.counters.size < 50_000) return;
    this.lastSweep = now;
    for (const [k, c] of this.counters) if (c.resetAt <= now) this.counters.delete(k);
  }
}

/** The address our own nginx saw: the LAST X-Forwarded-For entry (the one it
 * appended), then X-Real-IP, then the socket. A client can prepend anything
 * to X-Forwarded-For, but not change what nginx appends. */
export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const real = req.headers['x-real-ip'];
  const fromProxy = list.length ? list[list.length - 1] : typeof real === 'string' ? real : '';
  return (fromProxy || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function emailKey(req: Request): string | null {
  const body = req.body as { email?: unknown } | undefined;
  const e = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return e ? 'email:' + e.slice(0, 200) : null;
}
