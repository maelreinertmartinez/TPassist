// Onglet « Notions » : carte mentale du cours (générée sur demande), recherche, vue liste, plein écran ;
// chaque notion ouvre sa fiche dans un tiroir latéral.
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { CourseDetail, JobDto, NotionMapDto } from '@tpassist/shared';
import clsx from 'clsx';
import { AlertTriangle, Loader2, Network, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Callout, EmptyState, ErrorBox, ProgressBar, Spinner, useConfirm, useEscape } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useFullscreen } from '../../../lib/useFullscreen';
import { MapLegend } from './mapNodes';
import { NotionDrawer } from './NotionDrawer';
import { NotionMap } from './NotionMap';
import { NotionOutline } from './NotionOutline';
import { NotionsToolbar, type NotionsView } from './NotionsToolbar';
import { buildChapters, dependantsOf, searchNotions } from './tree';

const isBusy = (job: JobDto | null | undefined) => job?.status === 'queued' || job?.status === 'running';

/** Bandeaux d'état de la génération : en cours, échouée, ou carte à régénérer parce que les chapitres ont changé. */
function GenerationBanners({ map, generate }: { map: NotionMapDto; generate: UseMutationResult<JobDto, Error, void> }) {
  const { job, stale, notions } = map;
  const busy = isBusy(job);
  return (
    <>
      {busy && job && (
        <Callout tone="blue" icon={<Loader2 className="size-4 animate-spin" />} title={notions.length ? 'Mise à jour de la carte des notions…' : 'Génération de la carte des notions…'}>
          <p className="text-sm">{job.message}</p>
          <ProgressBar value={job.progress} onTint className="mt-2" />
        </Callout>
      )}
      {!busy && job?.status === 'error' && <ErrorBox error={`La génération de la carte a échoué : ${job.error ?? 'erreur inconnue'}`} onRetry={() => generate.mutate()} />}
      {!busy && stale && notions.length > 0 && (
        <Callout
          tone="yellow"
          icon={<AlertTriangle className="size-4" />}
          title="Tes chapitres ont changé depuis la génération de la carte"
          aside={
            <Button size="sm" variant="raised" loading={generate.isPending} onClick={() => generate.mutate()}>
              Régénérer
            </Button>
          }
        />
      )}
      <ErrorBox error={generate.error} />
    </>
  );
}

/**
 * Onglet « Notions » : carte mentale du cours, générée sur demande ; chaque notion ouvre sa fiche.
 * @param detail la page du cours (chapitres, points bloquants, nom et icône pour la racine de la carte)
 */
export function NotionsTab({ detail }: { detail: CourseDetail }) {
  const courseId = detail.course.id;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const map = useQuery({
    queryKey: ['notions', courseId],
    queryFn: () => api.get<NotionMapDto>(`/api/courses/${courseId}/notions`),
    refetchInterval: (q) => (isBusy(q.state.data?.job) ? 2000 : false),
  });
  // Génération demandée : à la fin du job, le compteur de l'onglet (détail du cours) est rafraîchi.
  const awaitedJob = useRef<string | null>(null);
  const generate = useMutation({
    mutationFn: () => api.post<JobDto>(`/api/courses/${courseId}/notions/generate`),
    onSuccess: (job) => {
      awaitedJob.current = job.id;
      void qc.invalidateQueries({ queryKey: ['notions', courseId] });
    },
  });
  const job = map.data?.job;
  useEffect(() => {
    if (!job || job.id !== awaitedJob.current || isBusy(job)) return;
    awaitedJob.current = null;
    void qc.invalidateQueries({ queryKey: ['course', courseId] });
  }, [job, qc, courseId]);

  const [view, setView] = useState<NotionsView>('carte');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const fullscreen = useFullscreen();
  // Échap sans plein écran du navigateur : ferme d'abord le panneau de détail (qui gère sa touche), puis le plein écran.
  useEscape(() => {
    if (!selectedId) fullscreen.exit();
  }, fullscreen.active);

  const notions = useMemo(() => map.data?.notions ?? [], [map.data]);
  const chapters = useMemo(() => buildChapters(detail.units, notions), [detail.units, notions]);
  const byId = useMemo(() => new Map(notions.map((n) => [n.id, n])), [notions]);
  const dependants = useMemo(() => dependantsOf(notions), [notions]);
  const found = useMemo(() => searchNotions(notions, query), [notions, query]);
  const matches = useMemo(() => new Set(found.map((n) => n.id)), [found]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const select = useCallback((id: string) => setSelectedId(id), []);
  const close = useCallback(() => setSelectedId(null), []);
  /** Ouvre une notion et centre la carte dessus. */
  const focusOn = useCallback((id: string) => {
    setSelectedId(id);
    setFocus({ id, nonce: Date.now() });
  }, []);

  if (map.isLoading) return <Spinner label="Chargement des notions…" />;
  if (map.error || !map.data) return <ErrorBox error={map.error ?? 'Notions introuvables'} onRetry={() => map.refetch()} />;

  const banners = <GenerationBanners map={map.data} generate={generate} />;
  if (notions.length === 0) {
    return (
      <div className="space-y-4">
        {banners}
        {!isBusy(job) && (
          <EmptyState
            icon={<Network className="size-6" />}
            title="Carte des notions"
            action={
              <Button variant="primary" icon={<Sparkles className="size-4" />} loading={generate.isPending} onClick={() => generate.mutate()}>
                Générer la carte des notions
              </Button>
            }
          >
            L’IA relève les définitions, théorèmes, méthodes et formules de tes chapitres et les relie entre elles. Clique ensuite sur une notion pour obtenir sa fiche complète.
          </EmptyState>
        )}
      </div>
    );
  }

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Régénérer la carte des notions ?',
      message: 'L’IA relit tous tes chapitres. Les fiches déjà rédigées sont gardées pour les notions dont le nom ne change pas.',
      confirmLabel: 'Régénérer',
    });
    if (ok) generate.mutate();
  };
  const inFullscreen = fullscreen.active && view === 'carte';

  return (
    <div className="space-y-4">
      {banners}
      <div className={inFullscreen ? 'fixed inset-0 z-40 flex flex-col gap-4 bg-page p-4' : 'space-y-4'}>
        <NotionsToolbar
          courseName={detail.course.name}
          query={query}
          onQuery={setQuery}
          found={found}
          onOpen={focusOn}
          view={view}
          onView={setView}
          fullscreen={inFullscreen}
          onFullscreen={(on) => (on ? fullscreen.enter() : fullscreen.exit())}
          onRegenerate={regenerate}
          canRegenerate={!isBusy(job) && !generate.isPending}
        />

        {view === 'carte' ? (
          <>
            <div className={clsx('overflow-hidden rounded-lg bg-page shadow-e1', inFullscreen ? 'min-h-0 flex-1' : 'h-[70dvh] min-h-96')}>
              <NotionMap
                key={map.data.generatedAt ?? 0}
                course={{ name: detail.course.name, icon: detail.course.icon, color: detail.course.color }}
                chapters={chapters}
                notions={notions}
                byId={byId}
                dependants={dependants}
                selectedId={selectedId}
                matches={matches}
                onSelect={select}
                focus={focus}
                expanded={inFullscreen}
              />
            </div>
            <MapLegend selected={selected} hasWeak={notions.some((n) => n.weakPointIds.length > 0)} />
          </>
        ) : (
          <NotionOutline chapters={chapters} query={query} matches={matches} selectedId={selectedId} onSelect={select} />
        )}
      </div>

      <NotionDrawer
        notion={selected}
        byId={byId}
        dependants={dependants}
        chapterTitle={chapters.find((c) => c.id === selected?.unitId)?.title ?? ''}
        weakPoints={detail.weakPoints}
        courseId={courseId}
        onSelect={focusOn}
        onClose={close}
      />
    </div>
  );
}
