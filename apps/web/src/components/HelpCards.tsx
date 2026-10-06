import type { CourseRef, EventKind, HelpEventDto } from '@tpassist/shared';
import clsx from 'clsx';
import { BookOpen, CheckCircle2, Lightbulb, MessageSquareText, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Markdown } from './Markdown';
import { Badge, Modal, Spinner } from './ui';

const META: Record<Exclude<EventKind, 'error_location' | 'error_explanation'>, { title: string; icon: ReactNode; tone: string }> = {
  reformulation: { title: 'Reformulation', icon: <MessageSquareText className="size-4" />, tone: 'border-l-accent' },
  course_refs: { title: 'Partie de cours utile', icon: <BookOpen className="size-4" />, tone: 'border-l-[#0891b2]' },
  hint: { title: 'Indice', icon: <Lightbulb className="size-4" />, tone: 'border-l-warn' },
  solution: { title: 'Solution', icon: <CheckCircle2 className="size-4" />, tone: 'border-l-ok' },
};

export function HelpCard({ kind, contentMd, courseRefs, solutionSource, streaming }: Partial<HelpEventDto> & { kind: keyof typeof META; streaming?: boolean }) {
  const meta = META[kind];
  return (
    <div className={clsx('print-break rounded-xl border border-border border-l-4 bg-surface px-4 py-3', meta.tone)} id={`help-${kind}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {meta.icon} {meta.title}
        </p>
        {kind === 'solution' && solutionSource && (
          <Badge tone={solutionSource === 'official' ? 'ok' : 'accent'}>
            {solutionSource === 'official' ? (
              <>
                <CheckCircle2 className="size-3" /> D’après le corrigé officiel
              </>
            ) : (
              <>
                <Sparkles className="size-3" /> Solution générée par l’IA
              </>
            )}
          </Badge>
        )}
      </div>
      {kind === 'course_refs' && courseRefs && courseRefs.length > 0 ? (
        <CourseRefs refs={courseRefs} />
      ) : contentMd ? (
        <Markdown className="text-sm">{contentMd}</Markdown>
      ) : streaming ? (
        <Spinner label="Rédaction en cours…" />
      ) : null}
    </div>
  );
}

function CourseRefs({ refs }: { refs: CourseRef[] }) {
  const [page, setPage] = useState<{ url: string; label: string } | null>(null);
  return (
    <div className="space-y-3">
      {refs.map((r) => (
        <div key={r.sectionId} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">
              {r.title} <span className="text-xs font-normal text-muted">— {r.unitTitle}</span>
            </p>
            {r.documentId && r.pageStart && (
              <button
                className="text-xs font-medium text-accent hover:underline"
                onClick={() => setPage({ url: `/api/documents/${r.documentId}/pages/${r.pageStart}`, label: `${r.unitTitle} — page ${r.pageStart}` })}
              >
                Voir p. {r.pageStart}
                {r.pageEnd && r.pageEnd !== r.pageStart ? `–${r.pageEnd}` : ''}
              </button>
            )}
          </div>
          <p className="text-sm text-muted">{r.why}</p>
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <Markdown className="text-sm">{r.excerptMd}</Markdown>
          </div>
        </div>
      ))}
      <Modal open={Boolean(page)} onClose={() => setPage(null)} title={page?.label ?? ''} wide>
        {page && <img src={page.url} alt={page.label} className="w-full rounded-lg border border-border" />}
      </Modal>
    </div>
  );
}
