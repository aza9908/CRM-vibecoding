'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { useLessonNotes, useSaveNotes } from '@/lib/api/hooks';
import { useAuthStore } from '@/lib/store/auth-store';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';

const AUTOSAVE_MS = 600;

export interface NotesTabProps {
  lessonId: string | undefined;
}

/**
 * "Notes" tab of the live workbook right panel (docs/08).
 *
 * A logged-in student keeps free-form notes per lesson, auto-saved (debounced
 * ~600ms) via `PUT /lessons/:id/notes`; initial content loads via GET. Notes
 * are tied to a **user** account, so a guest who joined only by session code
 * sees a brief sign-in hint instead — guests have no account to attach notes
 * to (docs/08 §5).
 */
export function NotesTab({ lessonId }: NotesTabProps) {
  const t = useTranslations('rightPanel');
  const tc = useTranslations('common');

  // Authenticated user vs. guest participant: notes require a real account.
  const user = useAuthStore((s) => s.user);
  const isGuest = !user;

  const notesQuery = useLessonNotes(lessonId, !isGuest);
  const save = useSaveNotes(lessonId);

  const [value, setValue] = React.useState('');
  // Seed the textarea once from the server, then let local edits own it.
  const seeded = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (seeded.current) return;
    if (notesQuery.data) {
      setValue(notesQuery.data.content ?? '');
      seeded.current = true;
    }
  }, [notesQuery.data]);

  const saveRef = React.useRef(save);
  saveRef.current = save;

  const scheduleSave = React.useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveRef.current.mutate(next);
    }, AUTOSAVE_MS);
  }, []);

  // Flush any pending save on unmount so the latest keystrokes aren't lost.
  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    scheduleSave(next);
  };

  if (isGuest) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <LogIn className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('notesGuestHint')}</p>
      </div>
    );
  }

  if (notesQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <Textarea
        value={value}
        onChange={onChange}
        placeholder={t('notesPlaceholder')}
        className="min-h-[200px] flex-1 resize-none"
        aria-label={t('notes')}
      />
      <p className="text-right text-xs text-muted-foreground" aria-live="polite">
        {save.isPending
          ? tc('loading')
          : save.isError
            ? tc('error')
            : t('notesSaved')}
      </p>
    </div>
  );
}
