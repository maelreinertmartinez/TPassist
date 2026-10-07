// Barre de progression de la séance : une case par question, colorée selon son statut.
import type { OutlineItem } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, XCircle } from 'lucide-react';
import { plural } from '../../lib/format';

const STATUS_META: Record<OutlineItem['status'], { label: string; bar: string }> = {
  correct: { label: 'juste', bar: 'bg-green-500' },
  wrong: { label: 'fausse', bar: 'bg-red-500' },
  skipped: { label: 'passée', bar: 'bg-yellow-500' },
  seen: { label: 'en cours', bar: 'bg-hover' },
  unseen: { label: 'à faire', bar: 'bg-hover' },
};

/**
 * @param index position de la question en cours dans `outline`
 * @param canJump mode examen : un clic sur une case ouvre la question
 */
export function Progress({ outline, currentId, index, canJump, onJump }: { outline: OutlineItem[]; currentId: string | null; index: number; canJump: boolean; onJump: (id: string) => void }) {
  const correct = outline.filter((o) => o.status === 'correct').length;
  const wrong = outline.filter((o) => o.status === 'wrong').length;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm font-semibold whitespace-nowrap">
        Question {index + 1} <span className="font-normal text-ink-3">sur {outline.length}</span>
      </span>
      <div className="flex min-w-32 max-w-sm flex-1 gap-1" aria-hidden={!canJump}>
        {outline.map((o, i) => {
          const isCurrent = o.id === currentId;
          const label = `Question ${i + 1} (${o.exerciseTitle} — ${o.label}) : ${isCurrent ? 'en cours' : STATUS_META[o.status].label}`;
          return (
            <button
              type="button"
              key={o.id}
              disabled={!canJump}
              title={label}
              aria-label={label}
              onClick={() => onJump(o.id)}
              className={clsx(
                'h-2 flex-1 rounded-full transition-colors',
                // En mode examen, une question répondue reste « vue » : on la distingue en bleu clair.
                isCurrent ? 'bg-accent' : o.answered && o.status === 'seen' ? 'bg-blue-300' : STATUS_META[o.status].bar,
                canJump && 'cursor-pointer hover:opacity-75',
              )}
            />
          );
        })}
      </div>
      {(correct > 0 || wrong > 0) && (
        <span className="inline-flex items-center gap-3 text-sm text-ink-3">
          {correct > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-4 text-green-600" /> {plural(correct, 'juste')}
            </span>
          )}
          {wrong > 0 && (
            <span className="inline-flex items-center gap-1">
              <XCircle className="size-4 text-red-600" /> {plural(wrong, 'fausse')}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
