// Énoncé d'une question : énoncé commun de l'exercice (sur fond gris) puis la question elle-même.
import { Markdown } from './Markdown';

/** `compact` : version plus petite, pour le bilan. */
export function QuestionStatement({ contextMd, statementMd, compact }: { contextMd: string; statementMd: string; compact?: boolean }) {
  return (
    <>
      {contextMd.trim() && (
        <div className="rounded-lg bg-block px-4 py-3">
          <Markdown className={compact ? 'text-sm' : undefined}>{contextMd}</Markdown>
        </div>
      )}
      <Markdown className={compact ? undefined : 'text-base'}>{statementMd}</Markdown>
    </>
  );
}
