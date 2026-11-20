'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, Search, Upload } from 'lucide-react';
import {
  downloadBrowserRecording,
  googleClientId,
  recoverRecording,
  requestGoogleToken,
  scanBrowserRecordings,
  type BrowserRecordingFind,
} from '@/lib/rtc/recorder';
import { useAuthStore } from '@/lib/store/auth-store';
import { Button } from '@/components/ui/button';

const size = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} ГБ` : `${(n / 1024 ** 2).toFixed(1)} МБ`;

/**
 * «Найти запись урока»: looks through this browser's recording database for
 * anything a lesson recording left behind and offers what can be done with
 * it — save the video as a file, or ask YouTube to finish an upload.
 */
export function RecordingFinder({ className }: { className?: string }) {
  const t = useTranslations('videoRoom');
  const role = useAuthStore((s) => s.user?.role);
  const staff = role === 'teacher' || role === 'methodist' || role === 'admin';
  const [open, setOpen] = React.useState(false);
  const [finds, setFinds] = React.useState<BrowserRecordingFind[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<Record<string, React.ReactNode>>({});

  const scan = React.useCallback(async () => {
    setFinds(null);
    setFinds(await scanBrowserRecordings());
  }, []);

  if (!staff) return null;

  const save = async (f: BrowserRecordingFind) => {
    setBusy(f.recId);
    try {
      const name = f.meta?.fileName ?? `Запись урока ${new Date(f.meta?.createdAt ?? Date.now()).toLocaleString('ru-RU')}.webm`;
      const n = await downloadBrowserRecording(f.recId, name);
      setMsg((m) => ({ ...m, [f.recId]: n > 0 ? t('findSaved', { size: size(n) }) : t('findNoVideo') }));
    } finally {
      setBusy(null);
    }
  };
  const finishYoutube = async (f: BrowserRecordingFind) => {
    if (!f.meta) return;
    setBusy(f.recId);
    try {
      const clientId = googleClientId();
      const token = clientId
        ? await requestGoogleToken(clientId, 'youtube', useAuthStore.getState().user?.email).catch(() => null)
        : null;
      const res = await recoverRecording(f.chunks > 0 ? f.meta : { ...f.meta, streamOnly: true }, undefined, token);
      setMsg((m) => ({
        ...m,
        [f.recId]: res.link ? (
          <a href={res.link} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
            {res.link}
          </a>
        ) : (
          t('srvLocalFailed')
        ),
      }));
      await scan();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={className}>
      {!open ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            void scan();
          }}
        >
          <Search className="mr-1 h-4 w-4" />
          {t('findTitle')}
        </Button>
      ) : (
        <div className="rounded-xl border bg-card p-3 text-sm shadow-sm">
          <p className="mb-2 font-semibold">{t('findTitle')}</p>
          {finds === null ? (
            <p className="text-muted-foreground">{t('findScanning')}</p>
          ) : finds.length === 0 ? (
            <p className="text-muted-foreground">{t('findNothing')}</p>
          ) : (
            <ul className="space-y-2">
              {finds.map((f) => (
                <li key={f.recId} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.meta?.title ?? t('findUntitled')}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.meta ? new Date(f.meta.createdAt).toLocaleString('ru-RU') + ' · ' : ''}
                      {f.meta?.target === 'youtube' ? 'YouTube' : f.meta?.target === 'drive' ? 'Google Drive' : t('findLocal')}
                      {' · '}
                      {f.chunks > 0 ? t('findVideoHere', { size: size(f.bytes) }) : t('findVideoNotHere')}
                    </p>
                    {msg[f.recId] ? <p className="mt-1 text-xs">{msg[f.recId]}</p> : null}
                  </div>
                  {f.chunks > 0 ? (
                    <Button size="sm" onClick={() => void save(f)} disabled={busy === f.recId}>
                      <Download className="mr-1 h-3.5 w-3.5" />
                      {t('findDownload')}
                    </Button>
                  ) : null}
                  {f.meta?.sessionUrl && f.meta.target === 'youtube' ? (
                    <Button size="sm" variant="outline" onClick={() => void finishYoutube(f)} disabled={busy === f.recId}>
                      <Upload className="mr-1 h-3.5 w-3.5" />
                      {t('srvLocalFinish')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t('findElsewhere')}</p>
        </div>
      )}
    </section>
  );
}
