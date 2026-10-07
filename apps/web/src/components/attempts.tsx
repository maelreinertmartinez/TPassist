// Affichage des réponses de l'étudiant et de leur verdict, commun au lecteur de séance et au bilan.
import type { AnswerContent, Verdict } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Markdown } from './Markdown';
import { Tag } from './ui';

const VERDICT_LABELS: Record<Exclude<Verdict, 'pending'>, string> = { correct: 'juste', partiel: 'incomplet', incorrect: 'faux' };

/** Étiquette du verdict d'une réponse (rien tant qu'elle n'est pas corrigée). */
export function VerdictTag({ verdict }: { verdict: Verdict }) {
  if (verdict === 'pending') return null;
  const ok = verdict === 'correct';
  return (
    <Tag tone={ok ? 'green' : 'red'}>
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {VERDICT_LABELS[verdict]}
    </Tag>
  );
}

/**
 * Contenu d'une réponse : photo de copie, code ou texte (Markdown + LaTeX).
 * `compact` : aperçu réduit (historique des essais), le texte y reste brut.
 */
export function AnswerView({ answer, compact }: { answer: AnswerContent; compact?: boolean }) {
  if (answer.type === 'image' && answer.imageUrl) {
    return <img src={answer.imageUrl} alt="Ta copie" className={compact ? 'max-h-48 rounded' : 'max-h-96 rounded-lg'} />;
  }
  if (compact) {
    return <pre className="max-h-48 overflow-auto rounded bg-block px-3 py-2 font-mono text-xs whitespace-pre-wrap">{answer.type === 'code' ? answer.code : answer.text}</pre>;
  }
  return (
    <div className={clsx('rounded-lg bg-block px-4 py-3', answer.type === 'code' && 'font-mono text-sm')}>
      {answer.type === 'code' ? <pre className="overflow-auto whitespace-pre-wrap">{answer.code}</pre> : <Markdown className="text-sm">{answer.text ?? ''}</Markdown>}
    </div>
  );
}
