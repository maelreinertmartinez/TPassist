// Éléments partagés par les listes de la page d'un cours.
import type { UnitKind } from '@tpassist/shared';
import { BookOpen, CheckCircle2, ClipboardCheck, FlaskConical, ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Icône de chaque type de partie. */
export const KIND_ICON: Record<UnitKind, ReactNode> = {
  cours: <BookOpen className="size-4" />,
  td: <ListChecks className="size-4" />,
  tp: <FlaskConical className="size-4" />,
  ei: <ClipboardCheck className="size-4" />,
  corrige: <CheckCircle2 className="size-4" />,
};

/** Compteur discret à côté d'un libellé d'onglet. */
export function Count({ n }: { n: number }) {
  return <span className="font-normal text-ink-4 tabular-nums">{n}</span>;
}

/** Ligne de liste « base de données » Notion : pas de bordure, fond au survol. */
export function Row({ icon, title, meta, actions, to }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; actions?: ReactNode; to?: string }) {
  const body = (
    <>
      <span className="flex h-6 shrink-0 items-center text-ink-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-6">{title}</p>
        {meta && <div className="mt-1 text-xs text-ink-3">{meta}</div>}
      </div>
    </>
  );
  // Sur un écran étroit, les actions passent sous le titre plutôt que de l'écraser.
  const main = 'flex min-w-0 flex-1 basis-64 items-start gap-3';
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded px-2 py-2 transition-colors hover:bg-hover">
      {to ? (
        <Link to={to} className={main}>
          {body}
        </Link>
      ) : (
        <div className={main}>{body}</div>
      )}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </li>
  );
}
