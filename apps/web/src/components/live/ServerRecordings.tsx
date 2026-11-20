'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, ExternalLink, Trash2, Upload, Youtube } from 'lucide-react';
import type { ServerRecording } from '@lms/shared';
import { serverRecordings } from '@/lib/api/recordings';
import {
  googleClientId,
  listUnfinishedRecordings,
  recoverRecording,
  requestGoogleToken,
  type SavedRecording,
} from '@/lib/rtc/recorder';
import { useAuthStore } from '@/lib/store/auth-store';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/** Ask Google for a fresh upload permission and hand it to the server. Call from a click. */
export async function sendRecordingToYoutube(id: string): Promise<ServerRecording> {
  const clientId = googleClientId();
  if (!clientId) throw new Error('google_not_configured');
  const token = await requestGoogleToken(clientId, 'youtube', useAuthStore.getState().user?.email);
  return serverRecordings.sendToYoutube(id, token);
}

const RECENT_KEY = 'lms-recordings-recent';
function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}
/** Remember a recording so its YouTube link is shown when it is done. */
export function watchServerRecording(id: string): void {
  try {
    const list = [id, ...readRecent().filter((x) => x !== id)].slice(0, 10);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('lms-recordings-changed'));
  } catch {
    /* only affects showing the link */
  }
}
function forget(id: string): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter((x) => x !== id)));
  } catch {
    /* ignore */
  }
}

const mb = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} ГБ` : `${Math.max(1, Math.round(n / 1024 ** 2))} МБ`;

/**
 * Lesson recordings waiting on the LMS server to go to YouTube, with their
 * progress, a «send to YouTube» button (needs the host's Google sign-in) and
 * the link once YouTube has the video. Staff only.
 */
export function ServerRecordings({ className }: { className?: string }) {
  const t = useTranslations('videoRoom');
  const role = useAuthStore((s) => s.user?.role);
  const staff = role === 'teacher' || role === 'methodist' || role === 'admin';
  const [items, setItems] = React.useState<ServerRecording[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ id: string; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = React.useState<ServerRecording | null>(null);

  // Recordings streamed straight from this browser before (older version)
  // that never got finished: YouTube can finish them from what arrived.
  const [local, setLocal] = React.useState<SavedRecording[]>([]);
  const [localMsg, setLocalMsg] = React.useState<{ id: string; text: string; link?: string } | null>(null);
  const loadLocal = React.useCallback(async () => {
    const list = await listUnfinishedRecordings();
    setLocal(list.filter((r) => r.streamOnly && r.target === 'youtube'));
  }, []);
  React.useEffect(() => {
    if (staff) void loadLocal();
  }, [staff, loadLocal]);
  const finishLocal = async (r: SavedRecording) => {
    setBusy(r.recId);
    setLocalMsg(null);
    try {
      const clientId = googleClientId();
      const token = clientId
        ? await requestGoogleToken(clientId, 'youtube', useAuthStore.getState().user?.email)
        : null;
      const res = await recoverRecording(r, undefined, token);
      setLocalMsg(
        res.link
          ? { id: r.recId, text: t('srvDone'), link: res.link }
          : { id: r.recId, text: t('srvLocalFailed') },
      );
      await loadLocal();
    } catch {
      setLocalMsg({ id: r.recId, text: t('srvGoogleDenied') });
    } finally {
      setBusy(null);
    }
  };

  const load = React.useCallback(async () => {
    if (!staff) return;
    try {
      const pending = await serverRecordings.pending();
      const ids = new Set(pending.map((r) => r.id));
      const done: ServerRecording[] = [];
      for (const id of readRecent()) {
        if (ids.has(id)) continue;
        try {
          const r = await serverRecordings.get(id);
          if (r.status === 'done') done.push(r);
        } catch {
          forget(id);
        }
      }
      setItems([...pending, ...done]);
    } catch {
      /* offline — keep what we have */
    }
  }, [staff]);

  React.useEffect(() => {
    if (!staff) return;
    void load();
    const onChange = () => void load();
    window.addEventListener('lms-recordings-changed', onChange);
    return () => window.removeEventListener('lms-recordings-changed', onChange);
  }, [staff, load]);
  const active = items.some((r) => r.status === 'uploading' || r.status === 'recording');
  React.useEffect(() => {
    if (!staff) return;
    const id = window.setInterval(() => void load(), active ? 4000 : 30_000);
    return () => window.clearInterval(id);
  }, [staff, active, load]);

  const send = async (r: ServerRecording) => {
    setBusy(r.id);
    setError(null);
    try {
      watchServerRecording(r.id);
      await sendRecordingToYoutube(r.id);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError({ id: r.id, text: /popup|denied|closed/i.test(msg) ? t('srvGoogleDenied') : t('srvSendFailed') });
    } finally {
      setBusy(null);
    }
  };

  if (!staff || (items.length === 0 && local.length === 0 && !localMsg)) return null;
  return (
    <section className={className} aria-label={t('srvTitle')}>
      <div className="rounded-xl border bg-card p-3 text-sm shadow-sm">
        <p className="mb-2 flex items-center gap-2 font-semibold">
          <Youtube className="h-4 w-4 text-red-600" aria-hidden /> {t('srvTitle')}
        </p>
        {local.length > 0 || localMsg ? (
          <ul className="mb-2 space-y-2">
            {local.map((r) => (
              <li key={r.recId} className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{t('srvLocalHint')}</p>
                </div>
                <Button size="sm" onClick={() => void finishLocal(r)} disabled={busy === r.recId}>
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  {t('srvLocalFinish')}
                </Button>
              </li>
            ))}
            {localMsg ? (
              <li className="rounded-lg border p-2 text-xs">
                {localMsg.text}{' '}
                {localMsg.link ? (
                  <a href={localMsg.link} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                    {localMsg.link}
                  </a>
                ) : null}
              </li>
            ) : null}
          </ul>
        ) : null}
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {mb(r.bytes)} ·{' '}
                  {r.status === 'recording'
                    ? t('srvRecording')
                    : r.status === 'uploading'
                      ? `${t('srvUploading')} ${Math.round((r.progress ?? 0) * 100)}%`
                      : r.status === 'done'
                        ? t('srvDone')
                        : r.status === 'failed'
                          ? t('srvFailed')
                          : r.error === 'google_signin_expired'
                            ? t('srvSigninAgain')
                            : t('srvReady')}
                </p>
                {r.status === 'uploading' ? (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full bg-red-600 transition-all" style={{ width: `${Math.round((r.progress ?? 0) * 100)}%` }} />
                  </div>
                ) : null}
                {r.status === 'done' && r.fileKept ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t('srvTooLongHint')}</p>
                ) : null}
                {r.status === 'done' && r.privacy === 'private' ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t('recYoutubePrivate')}</p>
                ) : null}
                {r.status === 'failed' && r.error ? (
                  <p className="mt-1 break-words text-xs text-destructive">{r.error.slice(0, 160)}</p>
                ) : null}
                {error?.id === r.id ? <p className="mt-1 text-xs text-destructive">{error.text}</p> : null}
              </div>
              {r.status === 'done' && r.youtubeId ? (
                <a
                  href={`https://youtu.be/${r.youtubeId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {t('recOpenYoutube')} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              {r.fileKept && r.status !== 'uploading' ? (
                <Button size="sm" variant="outline" onClick={() => void serverRecordings.download(r.id).catch(() => undefined)}>
                  <Download className="mr-1 h-3.5 w-3.5" />
                  {t('findDownload')}
                </Button>
              ) : null}
              {r.status === 'done' && r.fileKept ? (
                <Button size="sm" variant="outline" onClick={() => void send(r)} disabled={busy === r.id}>
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  {t('srvSendAgain')}
                </Button>
              ) : null}
              {r.status === 'done' ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => {
                    forget(r.id);
                    setItems((l) => l.filter((x) => x.id !== r.id));
                  }}
                >
                  {t('srvHide')}
                </button>
              ) : r.status !== 'uploading' ? (
                <>
                  <Button size="sm" onClick={() => void send(r)} disabled={busy === r.id}>
                    <Upload className="mr-1 h-3.5 w-3.5" />
                    {t('srvSend')}
                  </Button>
                  <button
                    type="button"
                    aria-label={t('srvDelete')}
                    title={t('srvDelete')}
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                    onClick={() => setConfirmDel(r)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <ConfirmDialog
        open={!!confirmDel}
        title={t('srvDeleteTitle')}
        description={t('srvDeleteText')}
        confirmLabel={t('srvDelete')}
        destructive
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => {
          const r = confirmDel;
          setConfirmDel(null);
          if (r) void serverRecordings.remove(r.id).then(load).catch(() => undefined);
        }}
      />
    </section>
  );
}
