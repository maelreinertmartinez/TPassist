// Encadrés des aides obtenues sur une question (reformulation, partie de cours, indication, solution).
import type { CourseRef, EventKind, HelpEventDto } from '@tpassist/shared';
import { BookOpen, CheckCircle2, Lightbulb, Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Markdown } from './Markdown';
import { Callout, Modal, type Tone } from './ui';

/** Aides affichées sous l'énoncé (les détails d'erreur sont affichés avec la réponse fausse). */
export type HelpKindShown = Exclude<EventKind, 'error_location' | 'error_explanation'>;

/** Titre, icône, teinte et ordre d'affichage de chaque aide. */
export const HELP_META: Record<HelpKindShown, { title: string; icon: ReactNode; tone: Tone; order: number }> = {
  reformulation: { title: 'Reformulation', icon: <MessageSquareText className="size-4" />, tone: 'grey', order: 0 },
  course_refs: { title: 'Partie de cours utile', icon: <BookOpen className="size-4" />, tone: 'blue', order: 1 },
  hint: { title: 'Indication', icon: <Lightbulb className="size-4" />, tone: 'yellow', order: 2 },
  solution: { title: 'Solution expliquée', icon: <CheckCircle2 className="size-4" />, tone: 'green', order: 3 },
};

/** Encadré d'une aide ; `streaming` : le texte arrive encore. */
export function HelpCard({ kind, contentMd, courseRefs, solutionSource, streaming }: Partial<HelpEventDto> & { kind: HelpKindShown; streaming?: boolean }) {
  const meta = HELP_META[kind];
  return (
    <Callout
      id={`help-${kind}`}
      tone={meta.tone}
      icon={meta.icon}
      title={meta.title}
      aside={
        kind === 'solution' && solutionSource ? (
          <span className="inline-flex items-center gap-1 text-xs">
            {solutionSource === 'official' ? (
              <>
                <CheckCircle2 className="size-3" /> D’après le corrigé officiel
              </>
            ) : (
              <>
                <Sparkles className="size-3" /> Rédigée par l’IA
              </>
            )}
          </span>
        ) : undefined
      }
    >
      {kind === 'course_refs' && courseRefs && courseRefs.length > 0 ? (
        <CourseRefs refs={courseRefs} />
      ) : contentMd ? (
        <Markdown className="text-sm">{contentMd}</Markdown>
      ) : streaming ? (
        <span className="inline-flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Rédaction en cours…</span>
      ) : null}
    </Callout>
  );
}

function CourseRefs({ refs }: { refs: CourseRef[] }) {
  const [page, setPage] = useState<{ url: string; label: string } | null>(null);
  return (
    <div className="space-y-4">
      {refs.map((r) => (
        <div key={r.sectionId}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              {r.title} <span className="font-normal">· {r.unitTitle}</span>
            </p>
            {r.documentId && r.pageStart && (
              <button
                type="button"
                className="text-sm underline-offset-2 hover:underline"
                onClick={() => setPage({ url: `/api/documents/${r.documentId}/pages/${r.pageStart}`, label: `${r.unitTitle} — page ${r.pageStart}` })}
              >
                Voir p. {r.pageStart}
                {r.pageEnd && r.pageEnd !== r.pageStart ? `–${r.pageEnd}` : ''}
              </button>
            )}
          </div>
          <p className="mt-1 text-sm">{r.why}</p>
          <div className="mt-2 rounded bg-page px-3 py-2 text-ink">
            <Markdown className="text-sm">{r.excerptMd}</Markdown>
          </div>
        </div>
      ))}
      <Modal open={Boolean(page)} onClose={() => setPage(null)} title={page?.label ?? ''} wide>
        {page && <img src={page.url} alt={page.label} className="w-full rounded" />}
      </Modal>
    </div>
  );
}
