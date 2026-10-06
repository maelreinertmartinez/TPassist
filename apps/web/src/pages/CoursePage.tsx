import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UNIT_KIND_LABELS, type CourseDetail, type SessionMode, type UnitDto, type UnitKind } from '@tpassist/shared';
import clsx from 'clsx';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FileUp,
  FlaskConical,
  ListChecks,
  MessageCircleQuestion,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Sparkles,
  Timer,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChatPanel } from '../components/ChatPanel';
import { JobList } from '../components/JobList';
import { NotionsTab } from '../components/NotionsTab';
import { UploadDialog } from '../components/UploadDialog';
import { WeakPointsPanel } from '../components/WeakPointsPanel';
import {
  Button,
  Callout,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Menu,
  Modal,
  Segmented,
  Spinner,
  Tag,
  TextInput,
  Toggle,
  useConfirm,
  ViewTabs,
} from '../components/ui';
import { api } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';
import { formatDate } from '../lib/format';
import { CourseIconTile, IconPicker } from '../lib/courseIcons';
import { useDeleteCourse } from '../lib/useDeleteCourse';
import { ColorPicker } from './Dashboard';

const KIND_ICON: Record<UnitKind, ReactNode> = {
  cours: <BookOpen className="size-4" />,
  td: <ListChecks className="size-4" />,
  tp: <FlaskConical className="size-4" />,
  ei: <ClipboardCheck className="size-4" />,
  corrige: <CheckCircle2 className="size-4" />,
};

type Tab = 'cours' | 'notions' | 'exercices' | 'ei' | 'points' | 'historique' | 'documents';

export function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api.get<CourseDetail>(`/api/courses/${courseId}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const busy =
        d.jobs.some((j) => j.status === 'queued' || j.status === 'running') ||
        d.sessions.some((s) => s.status === 'reporting') ||
        d.quizzes.some((x) => x.status === 'generating') ||
        d.documents.some((x) => x.status === 'pending' || x.status === 'processing');
      return busy ? 2000 : false;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['course', courseId] });
  useBreadcrumbs(detail.data ? [{ label: detail.data.course.name }] : []);

  const [tab, setTab] = useState<Tab | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [eiGenOpen, setEiGenOpen] = useState(false);
  const [launchEi, setLaunchEi] = useState<UnitDto | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const deleteCourse = useDeleteCourse();

  const startSession = useMutation({
    mutationFn: (v: { unitId: string; mode: SessionMode; timeLimitMinutes?: number }) => api.post<{ id: string }>(`/api/units/${v.unitId}/sessions`, v),
    onSuccess: (s) => navigate(`/sessions/${s.id}`),
  });

  const d = detail.data;
  const docNames = useMemo(() => new Map(d?.documents.map((x) => [x.id, x.filename]) ?? []), [d?.documents]);
  const byKind = useMemo(() => {
    const m: Record<UnitKind, UnitDto[]> = { cours: [], td: [], tp: [], ei: [], corrige: [] };
    for (const u of d?.units ?? []) m[u.kind].push(u);
    return m;
  }, [d?.units]);

  if (detail.isLoading) return <Page><Spinner label="Chargement du cours…" /></Page>;
  if (detail.error || !d) return <Page><ErrorBox error={detail.error ?? 'Cours introuvable'} /></Page>;

  const exercises = [...byKind.td, ...byKind.tp].sort((a, b) => a.order - b.order);
  const inProgress = d.sessions.filter((s) => s.status === 'in_progress');
  const resume = inProgress[0];
  const hasContent = d.units.length > 0;
  const historyCount = d.sessions.length + d.quizzes.length;
  // Ordre du parcours : apprendre → pratiquer → s'évaluer → revoir → sources.
  const tabs: { value: Tab; label: ReactNode; hidden?: boolean }[] = [
    { value: 'cours', label: <>Cours <Count n={byKind.cours.length} /></>, hidden: byKind.cours.length === 0 },
    { value: 'notions', label: <>Notions {d.notionCount > 0 && <Count n={d.notionCount} />}</>, hidden: byKind.cours.length === 0 && d.notionCount === 0 },
    { value: 'exercices', label: <>TD & TP <Count n={exercises.length} /></>, hidden: exercises.length === 0 && byKind.corrige.length === 0 },
    { value: 'ei', label: <>EI <Count n={byKind.ei.length} /></>, hidden: byKind.ei.length === 0 },
    { value: 'points', label: <>Points bloquants <Count n={d.weakPoints.filter((w) => w.status === 'active').length} /></> },
    { value: 'historique', label: <>Historique <Count n={historyCount} /></>, hidden: historyCount === 0 },
    { value: 'documents', label: <>Documents <Count n={d.documents.length} /></> },
  ];
  const visibleTabs = tabs.filter((t) => !t.hidden);
  const activeTab: Tab = tab && visibleTabs.some((t) => t.value === tab) ? tab : (visibleTabs[0]?.value ?? 'documents');

  const launch = (u: UnitDto) => (u.kind === 'ei' ? setLaunchEi(u) : startSession.mutate({ unitId: u.id, mode: 'tp' }));

  return (
    <Page>
      {/* En-tête façon page Notion */}
      <header className="mb-8">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Changer l’icône et la couleur"
            aria-label="Changer l’icône et la couleur du cours"
            className="shrink-0 rounded-lg transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <CourseIconTile icon={d.course.icon} color={d.course.color} size="lg" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl leading-tight font-semibold tracking-tight">{d.course.name}</h1>
              <IconButton label="Modifier le cours" onClick={() => setSettingsOpen(true)}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton
                label="Supprimer le cours"
                disabled={deleteCourse.deletingId === d.course.id}
                onClick={() => deleteCourse.ask(d.course, () => navigate('/'))}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
            <p className="mt-1 text-sm text-ink-3">
              {[
                byKind.cours.length && `${byKind.cours.length} chapitre${byKind.cours.length > 1 ? 's' : ''}`,
                exercises.length && `${exercises.length} TD/TP`,
                byKind.ei.length && `${byKind.ei.length} EI`,
                `${d.documents.length} document${d.documents.length > 1 ? 's' : ''}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button icon={<FileUp className="size-4" />} onClick={() => setUploadOpen(true)}>
            Ajouter des fichiers
          </Button>
          <Menu
            label="Réviser"
            icon={<Sparkles className="size-4" />}
            items={[
              { label: 'Quiz complet sur le cours', icon: <Sparkles className="size-4" />, onSelect: () => setQuizOpen(true), disabled: !hasContent },
              {
                label: 'Générer une EI blanche',
                icon: <ClipboardCheck className="size-4" />,
                onSelect: () => setEiGenOpen(true),
                disabled: byKind.ei.length === 0,
                hint: byKind.ei.length === 0 ? 'Ajoute d’abord au moins une EI' : undefined,
              },
            ]}
          />
          <Button variant="tertiary" icon={<MessageCircleQuestion className="size-4" />} onClick={() => setChatOpen(true)}>
            Poser une question
          </Button>
        </div>
      </header>

      <div className="space-y-4">
        {resume && (
          <Callout
            tone="blue"
            icon={<Play className="size-4" />}
            title={`Tu en étais à « ${resume.unitTitle} »`}
            aside={
              <Button variant="primary" onClick={() => navigate(`/sessions/${resume.id}`)}>
                Reprendre
              </Button>
            }
          >
            <p className="text-sm">
              {resume.progress.done} question{resume.progress.done > 1 ? 's' : ''} terminée{resume.progress.done > 1 ? 's' : ''} sur {resume.progress.total}
              {inProgress.length > 1 && ` · ${inProgress.length - 1} autre(s) séance(s) en cours dans l’historique`}
            </p>
          </Callout>
        )}
        <ErrorBox error={deleteCourse.error} />
        <JobList jobs={d.jobs.filter((j) => j.type !== 'report' && j.type !== 'quiz' && j.type !== 'notions')} documentsById={docNames} onChange={refresh} />
        <ErrorBox error={startSession.error} />
      </div>

      {!hasContent && d.documents.length === 0 ? (
        <EmptyState
          icon={<FileUp className="size-6" />}
          title="Ajoute tes premiers PDF"
          action={
            <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => setUploadOpen(true)}>
              Ajouter des fichiers
            </Button>
          }
        >
          Cours, TD, TP, corrigés ou EI, même mélangés dans un seul fichier : l’IA détecte chaque partie et prépare les questions.
        </EmptyState>
      ) : (
        <div className="mt-8">
          <ViewTabs value={activeTab} onChange={setTab} items={tabs} />
          <div className="pt-4">
            {activeTab === 'exercices' && (
              <>
                <UnitList units={exercises} sessions={d.sessions} onLaunch={launch} launching={startSession.isPending ? startSession.variables?.unitId : undefined} />
                {byKind.corrige.length > 0 && (
                  <Toggle className="mt-6" summary={<span className="text-ink-3">Corrigés détectés ({byKind.corrige.length})</span>}>
                    <ul className="space-y-1">
                      {byKind.corrige.map((c) => {
                        const target = d.units.find((u) => u.id === c.correctsUnitId);
                        const matched = c.meta.solutions?.filter((s) => s.matchedQuestionId).length ?? 0;
                        return (
                          <Row
                            key={c.id}
                            icon={KIND_ICON.corrige}
                            title={c.title}
                            meta={target ? `Rattaché à « ${target.title} » · ${matched}/${c.meta.solutions?.length ?? 0} solutions associées` : 'Non rattaché'}
                            actions={
                              <Button size="sm" variant="tertiary" onClick={() => navigate(`/units/${c.id}/edit`)}>
                                Gérer
                              </Button>
                            }
                          />
                        );
                      })}
                    </ul>
                  </Toggle>
                )}
              </>
            )}
            {activeTab === 'ei' && (
              <UnitList units={byKind.ei} sessions={d.sessions} onLaunch={launch} launching={startSession.isPending ? startSession.variables?.unitId : undefined} />
            )}
            {activeTab === 'cours' && <CoursList units={byKind.cours} detail={d} onChange={refresh} />}
            {activeTab === 'notions' && <NotionsTab detail={d} />}
            {activeTab === 'historique' && <History detail={d} />}
            {activeTab === 'points' && <WeakPointsPanel points={d.weakPoints} onChange={refresh} />}
            {activeTab === 'documents' && <Documents detail={d} onChange={refresh} onAdd={() => setUploadOpen(true)} />}
          </div>
        </div>
      )}

      <UploadDialog courseId={d.course.id} open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} threadUrl={`/api/courses/${d.course.id}/chat`} subtitle={d.course.name} />
      <CourseQuizModal courseId={d.course.id} open={quizOpen} onClose={() => setQuizOpen(false)} />
      <GenerateEiModal detail={d} open={eiGenOpen} onClose={() => setEiGenOpen(false)} onDone={refresh} />
      <LaunchEiModal
        unit={launchEi}
        onClose={() => setLaunchEi(null)}
        loading={startSession.isPending}
        onLaunch={(mode, minutes) => startSession.mutate({ unitId: launchEi!.id, mode, timeLimitMinutes: minutes })}
      />
      <CourseSettingsModal detail={d} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-4 pt-12 pb-24 sm:px-6">{children}</div>;
}

function Count({ n }: { n: number }) {
  return <span className="font-normal text-ink-4 tabular-nums">{n}</span>;
}

/** Ligne de liste « base de données » Notion : pas de bordure, fond au survol. */
function Row({ icon, title, meta, actions, to }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; actions?: ReactNode; to?: string }) {
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

/** `sessions` : toutes les séances du cours, de la plus récente à la plus ancienne. */
function UnitList({ units, sessions, onLaunch, launching }: { units: UnitDto[]; sessions: CourseDetail['sessions']; onLaunch: (u: UnitDto) => void; launching?: string }) {
  const navigate = useNavigate();
  if (units.length === 0) return <p className="px-2 text-sm text-ink-3">Rien ici pour l’instant.</p>;
  return (
    <ul className="space-y-1">
      {units.map((u) => {
        const running = sessions.find((s) => s.unitId === u.id && s.status === 'in_progress');
        const last = sessions.find((s) => s.unitId === u.id && s.status !== 'in_progress');
        const meta = [
          UNIT_KIND_LABELS[u.kind],
          `${u.questionCount} question${u.questionCount > 1 ? 's' : ''}`,
          u.documentName ? `${u.documentName}, p. ${u.pageStart}–${u.pageEnd}` : u.origin === 'generated' ? 'générée par l’IA' : null,
          u.kind === 'ei' && u.meta.durationMinutes ? `${u.meta.durationMinutes} min` : null,
          last && (last.status === 'reporting' ? 'bilan en préparation' : `terminé le ${formatDate(last.updatedAt)}${last.score !== null ? ` · ${last.score}/20` : ''}`),
        ].filter(Boolean);
        return (
          <Row
            key={u.id}
            icon={KIND_ICON[u.kind]}
            title={u.title}
            meta={
              <span className="flex flex-wrap items-center gap-2">
                {meta.join(' · ')}
                {u.hasCorrection && (
                  <Tag tone="green">
                    <CheckCircle2 className="size-3" /> Corrigé
                  </Tag>
                )}
                {u.origin === 'generated' && (
                  <Tag tone="blue">
                    <Sparkles className="size-3" /> IA
                  </Tag>
                )}
              </span>
            }
            actions={
              <>
                <IconButton label="Modifier la structure" onClick={() => navigate(`/units/${u.id}/edit`)}>
                  <Pencil className="size-4" />
                </IconButton>
                {last && (
                  <Button
                    size="sm"
                    variant="tertiary"
                    icon={last.reportId && last.status === 'done' ? <ScrollText className="size-4" /> : undefined}
                    loading={last.status === 'reporting' || !last.reportId}
                    onClick={() => last.reportId && navigate(`/reports/${last.reportId}`)}
                  >
                    Bilan
                  </Button>
                )}
                {running ? (
                  <Button size="sm" icon={<Play className="size-4" />} onClick={() => navigate(`/sessions/${running.id}`)}>
                    Reprendre
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    icon={last ? <RotateCcw className="size-4" /> : u.kind === 'ei' ? <Timer className="size-4" /> : <Play className="size-4" />}
                    loading={launching === u.id}
                    disabled={u.questionCount === 0}
                    onClick={() => onLaunch(u)}
                  >
                    {last ? 'Recommencer' : 'Lancer'}
                  </Button>
                )}
              </>
            }
          />
        );
      })}
    </ul>
  );
}

function CoursList({ units, detail, onChange }: { units: UnitDto[]; detail: CourseDetail; onChange: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/units/${id}`),
    onSuccess: () => {
      onChange();
      // La carte des notions perd les notions de ce chapitre (et signale qu'elle est à mettre à jour).
      void qc.invalidateQueries({ queryKey: ['notions', detail.course.id] });
    },
  });
  const ask = async (u: UnitDto, sectionCount: number) => {
    const ok = await confirm({
      title: `Supprimer « ${u.title} » ?`,
      message: `${sectionCount === 0 ? 'Ce chapitre et ses notions seront supprimés.' : sectionCount === 1 ? 'Sa section et ses notions seront supprimées.' : `Ses ${sectionCount} sections et ses notions seront supprimées.`} Le PDF d’origine reste dans Documents : le réanalyser recréerait le chapitre.`,
      confirmLabel: 'Supprimer le chapitre',
      danger: true,
    });
    if (ok) remove.mutate(u.id);
  };
  return (
    <div className="space-y-2">
      <ErrorBox error={remove.error} />
      {units.map((u) => {
        const sections = detail.sections.filter((s) => s.unitId === u.id);
        const deleting = remove.isPending && remove.variables === u.id;
        return (
          <Toggle
            key={u.id}
            className={clsx(deleting && 'pointer-events-none opacity-50')}
            summary={
              <span className="group/row flex items-center justify-between gap-2">
                <span className="truncate">{u.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-3">
                    {sections.length} section{sections.length > 1 ? 's' : ''}
                  </span>
                  {/* Dans le résumé du bloc dépliable : le clic ne doit pas le déplier. */}
                  <IconButton
                    label={`Supprimer « ${u.title} »`}
                    className="-my-1 transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void ask(u, sections.length);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </span>
              </span>
            }
          >
            <div className="space-y-4 pb-4">
              {sections.map((s) => (
                <div key={s.id}>
                  <p className="text-sm font-semibold">
                    {s.title} <span className="font-normal text-ink-3">· p. {s.pageStart}–{s.pageEnd}</span>
                  </p>
                  {s.summary && <p className="mt-1 max-w-[65ch] text-sm text-ink-2">{s.summary}</p>}
                  {s.keyConcepts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.keyConcepts.slice(0, 8).map((k) => (
                        <Tag key={k}>{k}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="tertiary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/units/${u.id}/edit`)}>
                  Modifier ce chapitre
                </Button>
                <Button size="sm" variant="danger-quiet" icon={<Trash2 className="size-4" />} loading={deleting} onClick={() => ask(u, sections.length)}>
                  Supprimer ce chapitre
                </Button>
              </div>
            </div>
          </Toggle>
        );
      })}
    </div>
  );
}

function History({ detail }: { detail: CourseDetail }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-8">
      {detail.sessions.length > 0 && (
        <section>
          <h2 className="mb-2 px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Séances</h2>
          <ul className="space-y-1">
            {detail.sessions.map((s) => (
              <Row
                key={s.id}
                icon={KIND_ICON[s.unitKind]}
                title={s.unitTitle}
                meta={
                  <>
                    {s.status === 'in_progress'
                      ? `En cours · ${s.progress.done}/${s.progress.total} questions`
                      : s.status === 'reporting'
                        ? 'Bilan en préparation…'
                        : `Terminée${s.score !== null ? ` · ${s.score}/20` : ''}`}
                    {' · '}
                    {formatDate(s.updatedAt)}
                  </>
                }
                actions={
                  s.status === 'in_progress' ? (
                    <Button size="sm" icon={<Play className="size-4" />} onClick={() => navigate(`/sessions/${s.id}`)}>
                      Reprendre
                    </Button>
                  ) : s.reportId ? (
                    <Button size="sm" variant="tertiary" icon={s.status === 'reporting' ? undefined : <ScrollText className="size-4" />} loading={s.status === 'reporting'} onClick={() => navigate(`/reports/${s.reportId}`)}>
                      Bilan
                    </Button>
                  ) : (
                    <Spinner />
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
      {detail.quizzes.length > 0 && (
        <section>
          <h2 className="mb-2 px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Quiz</h2>
          <ul className="space-y-1">
            {detail.quizzes.map((q) => (
              <Row
                key={q.id}
                to={`/quizzes/${q.id}`}
                icon={<Sparkles className="size-4" />}
                title={q.title}
                meta={formatDate(q.createdAt)}
                actions={
                  q.status === 'generating' ? (
                    <Spinner />
                  ) : q.status === 'error' ? (
                    <Tag tone="red">
                      <AlertCircle className="size-3" /> Erreur
                    </Tag>
                  ) : q.status === 'done' ? (
                    <Tag tone="green">
                      <CheckCircle2 className="size-3" /> {q.score}/{q.total}
                    </Tag>
                  ) : (
                    <Tag tone="blue">À faire</Tag>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Documents({ detail, onChange, onAdd }: { detail: CourseDetail; onChange: () => void; onAdd: () => void }) {
  const confirm = useConfirm();
  const reanalyze = useMutation({ mutationFn: (id: string) => api.post(`/api/documents/${id}/reanalyze`), onSuccess: onChange });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/documents/${id}`), onSuccess: onChange });
  const ask = async (doc: CourseDetail['documents'][number], action: 'reanalyze' | 'delete') => {
    const { count } = await api.get<{ count: number }>(`/api/documents/${doc.id}/sessions-count`);
    const warn = count ? ` ${count} séance(s) liée(s) à ce document seront supprimées.` : '';
    const ok = await confirm(
      action === 'reanalyze'
        ? { title: `Réanalyser « ${doc.filename} » ?`, message: `Les parties détectées seront recréées par l’IA.${warn}`, confirmLabel: 'Réanalyser', danger: Boolean(count) }
        : { title: `Supprimer « ${doc.filename} » ?`, message: `Le fichier et tout ce qui en a été extrait seront supprimés.${warn}`, confirmLabel: 'Supprimer', danger: true },
    );
    if (ok) (action === 'reanalyze' ? reanalyze : remove).mutate(doc.id);
  };
  if (detail.documents.length === 0) {
    return (
      <EmptyState icon={<FileText className="size-6" />} title="Aucun document" action={<Button variant="primary" icon={<FileUp className="size-4" />} onClick={onAdd}>Ajouter des fichiers</Button>}>
        Importe tes PDF : l’IA les découpe en chapitres, TD, TP, corrigés et EI.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-1">
      {detail.documents.map((doc) => (
        <Row
          key={doc.id}
          icon={<FileText className="size-4" />}
          title={
            <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="hover:underline">
              {doc.filename}
            </a>
          }
          meta={
            doc.status === 'ready' ? (
              `${doc.pageCount} pages · analysé`
            ) : doc.status === 'error' ? (
              <span className="inline-flex items-center gap-1 text-red-600">
                <AlertCircle className="size-3" /> {doc.error}
              </span>
            ) : doc.status === 'processing' ? (
              'Analyse en cours…'
            ) : (
              'En attente…'
            )
          }
          actions={
            <>
              <IconButton label="Réanalyser" onClick={() => ask(doc, 'reanalyze')}>
                <RefreshCw className="size-4" />
              </IconButton>
              <IconButton label="Supprimer" onClick={() => ask(doc, 'delete')}>
                <Trash2 className="size-4" />
              </IconButton>
            </>
          }
        />
      ))}
    </ul>
  );
}

function CourseQuizModal({ courseId, open, onClose }: { courseId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [size, setSize] = useState<'court' | 'moyen' | 'long'>('court');
  const create = useMutation({ mutationFn: () => api.post<{ id: string }>(`/api/courses/${courseId}/quizzes`, { size }), onSuccess: (q) => navigate(`/quizzes/${q.id}`) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quiz complet sur le cours"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Générer le quiz
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-ink-2">QCM et questions ouvertes sur tout le cours. Tes points bloquants sont travaillés en priorité, sur environ 60 % des questions.</p>
        <Segmented
          value={size}
          onChange={setSize}
          items={[
            { value: 'court', label: '10 questions' },
            { value: 'moyen', label: '20 questions' },
            { value: 'long', label: '30 questions' },
          ]}
        />
        <ErrorBox error={create.error} />
      </div>
    </Modal>
  );
}

function GenerateEiModal({ detail, open, onClose, onDone }: { detail: CourseDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [difficulty, setDifficulty] = useState('standard');
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api.post(`/api/courses/${detail.course.id}/generate-ei`, { difficulty, sectionIds }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const chapters = detail.units.filter((u) => u.kind === 'cours');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Générer une EI blanche"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Générer l’EI
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-ink-2">L’IA reprend le style et le barème de tes EI, couvre le cours et donne la priorité à tes points bloquants. L’EI apparaîtra dans l’onglet EI.</p>
        <Field label="Difficulté">
          <Segmented
            value={difficulty}
            onChange={setDifficulty}
            items={[
              { value: 'facile', label: 'Facile' },
              { value: 'standard', label: 'Standard' },
              { value: 'difficile', label: 'Difficile' },
            ]}
          />
        </Field>
        {chapters.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Chapitres à cibler</legend>
            <p className="mb-2 text-xs text-ink-3">Optionnel : sans sélection, tout le cours est couvert.</p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {chapters.flatMap((u) =>
                detail.sections
                  .filter((s) => s.unitId === u.id)
                  .map((s) => (
                    <label key={s.id} className="flex items-center gap-3 rounded px-2 py-1 text-sm hover:bg-hover">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={sectionIds.includes(s.id)}
                        onChange={(e) => setSectionIds((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                      />
                      <span className="truncate">
                        {s.title} <span className="text-ink-3">· {u.title}</span>
                      </span>
                    </label>
                  )),
              )}
            </div>
          </fieldset>
        )}
        <ErrorBox error={create.error} />
      </div>
    </Modal>
  );
}

const EI_MODES: { value: SessionMode; title: string; description: string; icon: ReactNode }[] = [
  {
    value: 'ei_examen',
    title: 'Sans aide',
    description: 'Comme le jour J : ni aide ni chat, aucune correction pendant l’épreuve. Note sur 20 à la fin.',
    icon: <ClipboardCheck className="size-4" />,
  },
  {
    value: 'ei_aides',
    title: 'Avec aides',
    description: 'Comme un TD : aides, vérification et chat, avec le chronomètre. Note sur 20 à la fin.',
    icon: <Sparkles className="size-4" />,
  },
];

function LaunchEiModal({ unit, onClose, onLaunch, loading }: { unit: UnitDto | null; onClose: () => void; onLaunch: (mode: SessionMode, minutes: number) => void; loading: boolean }) {
  const [mode, setMode] = useState<SessionMode>('ei_examen');
  const [minutes, setMinutes] = useState<number | ''>('');
  const duration = minutes || unit?.meta.durationMinutes || 120;
  return (
    <Modal
      open={Boolean(unit)}
      onClose={onClose}
      title={`Lancer « ${unit?.title ?? ''} »`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={loading} onClick={() => onLaunch(mode, Number(duration))} icon={<Timer className="size-4" />}>
            Commencer l’épreuve
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
          {EI_MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={clsx(
                'rounded-lg p-4 text-left transition-shadow',
                mode === m.value ? 'bg-tint-blue text-tint-blue-ink ring-2 ring-accent' : 'bg-block hover:bg-hover',
              )}
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                {m.icon} {m.title}
                {mode === m.value && <CheckCircle2 className="ml-auto size-4 text-accent" />}
              </p>
              <p className="mt-1 text-xs">{m.description}</p>
            </button>
          ))}
        </div>
        <Field label="Durée en minutes" hint="Le chronomètre est sauvegardé : tu peux reprendre l’épreuve plus tard.">
          <TextInput type="number" min={5} value={minutes === '' ? duration : minutes} onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : '')} className="max-w-32" />
        </Field>
      </div>
    </Modal>
  );
}

function CourseSettingsModal({ detail, open, onClose }: { detail: CourseDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const deleteCourse = useDeleteCourse();
  const [name, setName] = useState(detail.course.name);
  const [color, setColor] = useState(detail.course.color);
  const [icon, setIcon] = useState(detail.course.icon);
  useEffect(() => {
    if (!open) return;
    setName(detail.course.name);
    setColor(detail.course.color);
    setIcon(detail.course.icon);
  }, [open]);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/courses/${detail.course.id}`, { name, color, icon }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', detail.course.id] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Modifier le cours"
      footer={
        <>
          <Button
            variant="danger-quiet"
            className="mr-auto"
            icon={<Trash2 className="size-4" />}
            loading={deleteCourse.deletingId === detail.course.id}
            onClick={() => deleteCourse.ask(detail.course, () => navigate('/'))}
          >
            Supprimer le cours
          </Button>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Field label="Nom">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
        <IconPicker value={icon} onChange={setIcon} color={color} />
        <ErrorBox error={save.error ?? deleteCourse.error} />
      </div>
    </Modal>
  );
}
