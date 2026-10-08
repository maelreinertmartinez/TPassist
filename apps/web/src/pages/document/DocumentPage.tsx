// Page d'un document (ouverte depuis l'onglet Documents) : ses pages en miniatures, avec les parties déjà extraites,
// et l'ajout à la main d'une partie (cours, TD, TP, EI ou corrigé) à partir d'une plage de pages.
import { AlertCircle, ExternalLink, Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { JobList } from '../../components/JobList';
import { Button, Callout, ErrorBox, Page, Spinner, useEscape } from '../../components/ui';
import { useBreadcrumbs } from '../../lib/breadcrumbs';
import { formatPageRange, plural } from '../../lib/format';
import { useCourseDetail } from '../../lib/useCourseDetail';
import { AddUnitModal } from './AddUnitModal';
import { nextSelection, PageGrid, type PageRange } from './PageGrid';

/** Page d'un document (route /courses/:courseId/documents/:documentId). */
export function DocumentPage() {
  const { courseId, documentId } = useParams<{ courseId: string; documentId: string }>();
  const detail = useCourseDetail(courseId);
  const d = detail.data;
  const doc = d?.documents.find((x) => x.id === documentId);
  useBreadcrumbs(d ? [{ label: d.course.name, to: `/courses/${d.course.id}?tab=documents` }, { label: doc?.filename ?? 'Document' }] : []);

  const [selection, setSelection] = useState<PageRange | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  useEscape(() => setSelection(null), Boolean(selection) && !addOpen);

  const docUnits = useMemo(() => d?.units.filter((u) => u.documentId === documentId) ?? [], [d?.units, documentId]);

  if (detail.isLoading) return <Page><Spinner label="Chargement du document…" /></Page>;
  if (detail.error || !d) return <Page><ErrorBox error={detail.error ?? 'Cours introuvable'} /></Page>;
  if (!doc) return <Page><ErrorBox error="Document introuvable" /></Page>;

  const pageCount = doc.pageCount ?? 0;
  const ready = doc.status === 'ready' && pageCount > 0;
  const unassigned = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => !docUnits.some((u) => u.pageStart !== null && u.pageEnd !== null && p >= u.pageStart && p <= u.pageEnd),
  ).length;
  const docJobs = d.jobs.filter((j) => j.refId === doc.id && (j.type === 'ingest' || j.type === 'extract_unit'));
  const extracting = docJobs.filter((j) => j.type === 'extract_unit' && (j.status === 'queued' || j.status === 'running')).length;

  return (
    <Page>
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="min-w-0 text-3xl leading-tight font-semibold tracking-tight break-words">{doc.filename}</h1>
          <Button icon={<ExternalLink className="size-4" />} onClick={() => window.open(`/api/documents/${doc.id}/file`, '_blank', 'noreferrer')}>
            Ouvrir le PDF
          </Button>
        </div>
        {ready && (
          <p className="mt-1 text-sm text-ink-3">
            {[plural(pageCount, 'page'), plural(docUnits.length, 'partie'), unassigned > 0 && plural(unassigned, 'page non attribuée', 'pages non attribuées')]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </header>

      <div className="mb-8 space-y-4">
        <JobList jobs={docJobs} documentsById={new Map([[doc.id, doc.filename]])} onChange={detail.refresh} />
        {doc.status === 'error' && (
          <Callout tone="red" icon={<AlertCircle className="size-4" />} title="L’analyse de ce document a échoué">
            <p className="text-sm">{doc.error} Réanalyse-le depuis l’onglet Documents.</p>
          </Callout>
        )}
      </div>

      {ready ? (
        <>
          <PageGrid documentId={doc.id} pageCount={pageCount} units={docUnits} selection={selection} onPick={(p) => setSelection((cur) => nextSelection(cur, p))} />
          <div className="sticky bottom-4 z-10 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-raised px-4 py-3 shadow-e3">
            <div className="min-w-0 text-sm">
              {selection ? (
                <p>
                  <span className="font-semibold">{plural(selection.end - selection.start + 1, 'page')}</span>
                  <span className="text-ink-3"> · {formatPageRange(selection.start, selection.end)} · un clic sur une autre page ajuste le début ou la fin</span>
                </p>
              ) : (
                <p className="text-ink-3">Clique sur la première puis sur la dernière page de la partie à ajouter.</p>
              )}
              {extracting > 0 && (
                <p className="mt-1 inline-flex items-center gap-2 text-ink-3">
                  <Loader2 className="size-4 animate-spin" /> {plural(extracting, 'extraction en cours', 'extractions en cours')}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {selection && (
                <Button variant="tertiary" onClick={() => setSelection(null)}>
                  Effacer
                </Button>
              )}
              <Button variant="primary" icon={<Plus className="size-4" />} disabled={!selection} onClick={() => setAddOpen(true)}>
                Créer une partie…
              </Button>
            </div>
          </div>
          <AddUnitModal
            document={doc}
            selection={selection}
            units={d.units}
            open={addOpen}
            onClose={() => setAddOpen(false)}
            onCreated={() => {
              setSelection(null);
              void detail.refresh();
            }}
          />
        </>
      ) : (
        doc.status !== 'error' && <Spinner label="Analyse du document en cours : ses pages seront affichées une fois l’analyse terminée…" />
      )}
    </Page>
  );
}
