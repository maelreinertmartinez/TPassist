// Barre de la séance, collée sous la barre du haut sur grand écran : progression, mode, chronomètre et actions.
import { SESSION_MODE_LABELS, type SessionState } from '@tpassist/shared';
import clsx from 'clsx';
import { Flag, MessageCircleQuestion, Timer } from 'lucide-react';
import { Button, Tag } from '../../components/ui';
import { formatClock } from '../../lib/format';
import { Progress } from './Progress';
import type { SessionController } from './useSession';

/** Sous 5 minutes restantes, le chronomètre passe en rouge. */
const TIME_WARNING_SEC = 300;

/** Bouton « Terminer l'épreuve » (EI en mode examen), dans la barre et sous la dernière question. */
export function FinishExamButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="danger-quiet" icon={<Flag className="size-4" />} onClick={onClick}>
      Terminer l’épreuve
    </Button>
  );
}

/** @param onOpenChat ouvre le chat (absent en mode examen) */
export function SessionToolbar({ session: s, ctl, onOpenChat }: { session: SessionState; ctl: SessionController; onOpenChat: () => void }) {
  const index = s.outline.findIndex((o) => o.id === s.currentQuestionId);
  const timeLeft = s.session.timeLimitSec ? s.session.timeLimitSec - ctl.elapsedSec : null;
  return (
    <div className="no-print z-20 flex flex-wrap items-center justify-between gap-4 bg-page py-4 lg:sticky lg:top-12 lg:h-16 lg:py-0">
      <Progress outline={s.outline} currentId={s.currentQuestionId} index={index} canJump={ctl.isExam} onJump={(id) => ctl.goto.mutate(id)} />
      <div className="flex flex-wrap items-center gap-2">
        {s.session.mode !== 'tp' && <Tag tone={ctl.isExam ? 'red' : 'blue'}>{SESSION_MODE_LABELS[s.session.mode]}</Tag>}
        {timeLeft !== null && (
          <span
            className={clsx('inline-flex h-8 items-center gap-2 rounded px-3 text-sm tabular-nums', timeLeft < TIME_WARNING_SEC ? 'bg-tint-red text-tint-red-ink' : 'bg-block text-ink-2')}
            title="Temps restant"
          >
            <Timer className="size-4" /> {formatClock(Math.max(0, timeLeft))}
          </span>
        )}
        {ctl.isExam ? (
          <FinishExamButton onClick={ctl.onFinishExam} />
        ) : (
          <Button variant="tertiary" icon={<MessageCircleQuestion className="size-4" />} onClick={onOpenChat}>
            Poser une question
          </Button>
        )}
      </div>
    </div>
  );
}
