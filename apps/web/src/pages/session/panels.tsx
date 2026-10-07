// Panneau de droite du lecteur (« Ta solution ») : un contenu défilant et un pied fixe avec l'action principale.
import type { AttemptDto } from '@tpassist/shared';
import { CheckCircle2, ChevronRight, CircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Callout } from '../../components/ui';
import { AnswerReadOnly } from './answers';

/** Contenu défilant du panneau, sous un titre (avec une mention optionnelle à droite). */
export function PanelBody({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Pied du panneau, toujours visible. */
export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="space-y-2 border-t border-line p-4">{children}</div>;
}

/**
 * Question terminée : on invite à lire la solution expliquée (affichée sous l'énoncé) avant de continuer.
 * @param ready la solution est prête (le bouton reste désactivé pendant sa rédaction)
 * @param isLast dernière question : continuer termine la séance
 */
export function TransitionPanel({ attempts, ready, isLast, continuing, onContinue }: { attempts: AttemptDto[]; ready: boolean; isLast: boolean; continuing: boolean; onContinue: () => void }) {
  const firstTry = attempts[0]?.verdict === 'correct';
  const correct = attempts.some((a) => a.verdict === 'correct');
  const last = attempts[attempts.length - 1];
  return (
    <>
      <PanelBody title="Avant de continuer">
        <Callout tone={correct ? 'green' : 'blue'} icon={correct ? <CheckCircle2 className="size-4" /> : <CircleDashed className="size-4" />}>
          <p className="text-sm">
            {firstTry
              ? 'Juste dès le premier essai ! Compare ta démarche avec la solution complète, affichée sous l’énoncé.'
              : correct
                ? 'Tu as trouvé la bonne réponse. Relis la solution complète, sous l’énoncé, pour consolider.'
                : 'Prends le temps de comprendre la solution expliquée, affichée sous l’énoncé, avant de continuer.'}
          </p>
        </Callout>
        {last && <AnswerReadOnly attempt={last} title="Ta dernière réponse" />}
      </PanelBody>
      <PanelFooter>
        <Button variant="primary" size="lg" className="w-full" onClick={onContinue} loading={continuing} disabled={!ready} icon={<ChevronRight className="size-4" />}>
          {ready ? (isLast ? 'Terminer et voir mon bilan' : 'Continuer') : 'Préparation de la solution…'}
        </Button>
      </PanelFooter>
    </>
  );
}
