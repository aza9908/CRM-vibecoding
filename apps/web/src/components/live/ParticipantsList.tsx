'use client';

import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import type { LiveParticipant } from '@/lib/ws/useSessionSocket';

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** Teacher's live roster of joined participants. */
export function ParticipantsList({
  participants,
}: {
  participants: LiveParticipant[];
}) {
  const t = useTranslations('live');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          {t('participants')}{' '}
          <span className="text-muted-foreground">({participants.length})</span>
        </h2>
      </div>

      {participants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noParticipants')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {participants.map((p) => (
            <li
              key={p.participantId}
              className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-sm"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initial(p.name)}
              </span>
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
