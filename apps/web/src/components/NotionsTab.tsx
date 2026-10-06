import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NOTION_KIND_LABELS, type CourseDetail, type JobDto, type NotionDto, type NotionMapDto } from '@tpassist/shared';
import clsx from 'clsx';
import { AlertTriangle, List, Loader2, Maximize2, Minimize2, Network, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { buildChapters, dependantsOf, searchNotions, type ChapterTree } from '../lib/notions';
import { NotionDrawer } from './NotionDrawer';
import { NotionMap } from './NotionMap';
import { Button, Callout, EmptyState, ErrorBox, IconButton, inputClass, ProgressBar, Segmented, Spinner, useConfirm } from './ui';

const isBusy = (job: JobDto | null | undefined) => job?.status === 'queued' || job?.status === 'running';

/** Onglet « Notions » : carte mentale du cours, générée sur demande ; chaque notion ouvre sa fiche. */
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
  const [view, setView] = useState<'carte' | 'liste'>('carte');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Plein écran : la carte couvre la fenêtre et on demande au navigateur le plein écran de la page entière
  // (pour que le panneau de détail reste visible). Si le navigateur refuse, la carte couvre quand même la fenêtre.
  const enterFullscreen = () => {
    setFullscreen(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    // Échap côté navigateur : on quitte aussi notre plein écran.
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [fullscreen]);
  // Échap sans plein écran du navigateur : ferme d'abord le panneau de détail, puis le plein écran.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedId) exitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, selectedId, exitFullscreen]);
  // En quittant l'onglet, on sort du plein écran du navigateur.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
    [],
  );

  const job = map.data?.job;
  useEffect(() => {
    if (!job || job.id !== awaitedJob.current || isBusy(job)) return;
    awaitedJob.current = null;
    void qc.invalidateQueries({ queryKey: ['course', courseId] });
  }, [job, qc, courseId]);

  const notions = useMemo(() => map.data?.notions ?? [], [map.data]);
  const chapters = useMemo(() => buildChapters(detail.units, notions), [detail.units, notions]);
  const byId = useMemo(() => new Map(notions.map((n) => [n.id, n])), [notions]);
  const dependants = useMemo(() => dependantsOf(notions), [notions]);
  const found = useMemo(() => searchNotions(notions, query), [notions, query]);
  const matches = useMemo(() => new Set(found.map((n) => n.id)), [found]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const select = useCallback((id: string) => setSelectedId(id), []);
  const close = useCallback(() => setSelectedId(null), []);
  const focusOn = useCallback((id: string) => {
    setSelectedId(id);
    setFocus({ id, nonce: Date.now() });
  }, []);

  if (map.isLoading) return <Spinner label="Chargement des notions…" />;
  if (map.error || !map.data) return <ErrorBox error={map.error ?? 'Notions introuvables'} onRetry={() => map.refetch()} />;

  const { stale } = map.data;
  const busy = isBusy(job);
  const regenerate = async () => {
    const ok = await confirm({
      title: 'Régénérer la carte des notions ?',
      message: 'L’IA relit tous tes chapitres. Les fiches déjà rédigées sont gardées pour les notions dont le nom ne change pas.',
      confirmLabel: 'Régénérer',
    });
    if (ok) generate.mutate();
  };

  const banners = (
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

  if (notions.length === 0) {
    return (
      <div className="space-y-4">
        {banners}
        {!busy && (
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

  const hasWeak = notions.some((n) => n.weakPointIds.length > 0);

  const inFullscreen = fullscreen && view === 'carte';

  return (
    <div className="space-y-4">
      {banners}
      <div className={inFullscreen ? 'fixed inset-0 z-40 flex flex-col gap-4 bg-page p-4' : 'space-y-4'}>
        <div className="flex flex-wrap items-center gap-2">
          {inFullscreen && <p className="mr-2 max-w-xs truncate text-sm font-semibold">Notions · {detail.course.name}</p>}
          <label className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && found[0]) focusOn(found[0].id);
              }}
              placeholder="Rechercher une notion"
              aria-label="Rechercher une notion"
              className={clsx(inputClass, 'pl-8')}
            />
          </label>
          {query && (
            <span className="text-xs text-ink-3">
              {found.length === 0 ? 'Aucune notion' : `${found.length} notion${found.length > 1 ? 's' : ''} · Entrée pour ouvrir la première`}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {inFullscreen ? (
              <Button icon={<Minimize2 className="size-4" />} onClick={exitFullscreen} title="Échap">
                Quitter le plein écran
              </Button>
            ) : (
              <>
                <Segmented
                  value={view}
                  onChange={setView}
                  items={[
                    { value: 'carte', label: <><Network className="size-4" /> Carte</> },
                    { value: 'liste', label: <><List className="size-4" /> Liste</> },
                  ]}
                />
                {view === 'carte' && (
                  <IconButton label="Plein écran" onClick={enterFullscreen}>
                    <Maximize2 className="size-4" />
                  </IconButton>
                )}
                <IconButton label="Régénérer la carte" onClick={regenerate} disabled={busy || generate.isPending}>
                  <RefreshCw className="size-4" />
                </IconButton>
              </>
            )}
          </div>
        </div>

        {view === 'carte' ? (
          <>
            <div className={clsx('overflow-hidden rounded-lg bg-page shadow-e1', inFullscreen ? 'min-h-0 flex-1' : 'h-[70dvh] min-h-96')}>
              <NotionMap
                key={map.data.generatedAt ?? 0}
                course={{ name: detail.course.name, icon: detail.course.icon, color: detail.course.color }}
                chapters={chapters}
                notions={notions}
                selectedId={selectedId}
                matches={matches}
                onSelect={select}
                focus={focus}
                expanded={inFullscreen}
              />
            </div>
            <Legend selected={selected} hasWeak={hasWeak} />
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

function Legend({ selected, hasWeak }: { selected: NotionDto | null; hasWeak: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
      {selected ? (
        <>
          <span className="inline-flex items-center gap-2">
            <span className="w-4 border-t-2 border-dashed border-accent" /> prérequis de « {selected.title} »
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-4 border-t-2 border-dashed border-ink-4" /> notions qui l’utilisent
          </span>
        </>
      ) : (
        <span>Clique sur une notion pour ouvrir sa fiche, sur un chapitre pour le replier.</span>
      )}
      {hasWeak && (
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-red-500" /> point bloquant
        </span>
      )}
    </p>
  );
}

function NotionOutline({
  chapters,
  query,
  matches,
  selectedId,
  onSelect,
}: {
  chapters: ChapterTree[];
  query: string;
  matches: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const keep = (n: NotionDto & { children?: NotionDto[] }) => !query.trim() || matches.has(n.id) || Boolean(n.children?.some((c) => matches.has(c.id)));
  const visible = chapters.map((c) => ({ ...c, notions: c.notions.filter(keep) })).filter((c) => c.notions.length > 0);
  if (visible.length === 0) return <p className="px-2 text-sm text-ink-3">Aucune notion ne correspond à ta recherche.</p>;
  const row = (n: NotionDto, sub: boolean) => (
    <button
      type="button"
      onClick={() => onSelect(n.id)}
      className={clsx('flex w-full items-start gap-3 rounded px-2 py-1 text-left transition-colors hover:bg-hover', n.id === selectedId && 'bg-hover')}
    >
      <span className="min-w-0 flex-1">
        <span className={clsx('block', sub ? 'text-sm' : 'text-sm font-semibold')}>{n.title}</span>
        {n.summary && <span className="block truncate text-xs text-ink-3">{n.summary}</span>}
      </span>
      <span className="flex h-6 shrink-0 items-center gap-2 text-xs text-ink-3">
        {n.weakPointIds.length > 0 && <span className="size-2 rounded-full bg-red-500" title="Point bloquant" />}
        {NOTION_KIND_LABELS[n.kind]}
      </span>
    </button>
  );
  return (
    <div className="space-y-8">
      {visible.map((c) => (
        <section key={c.id}>
          <h3 className="mb-2 px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{c.title}</h3>
          <ul className="space-y-1">
            {c.notions.map((n) => (
              <li key={n.id}>
                {row(n, false)}
                {n.children.length > 0 && (
                  <ul className="mt-1 ml-6 space-y-1 border-l border-line pl-2">
                    {n.children.filter((s) => !query.trim() || matches.has(s.id) || matches.has(n.id)).map((s) => (
                      <li key={s.id}>{row(s, true)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
