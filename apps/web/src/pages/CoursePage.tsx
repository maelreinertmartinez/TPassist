import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UNIT_KIND_LABELS, type CourseDetail, type SessionMode, type UnitDto, type UnitKind } from '@tpassist/shared';
import clsx from 'clsx';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  FileUp,
  FlaskConical,
  ListChecks,
  MessageCircleQuestion,
  Pencil,
  Play,
  RefreshCw,
  ScrollText,
  Sparkles,
  Timer,
  Trash2,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChatPanel } from '../components/ChatPanel';
import { JobList } from '../components/JobList';
import { UploadDialog } from '../components/UploadDialog';
import { WeakPointsPanel } from '../components/WeakPointsPanel';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, inputClass, Modal, SectionTitle, Spinner, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { COURSE_COLORS } from './Dashboard';

const KIND_ICON: Record<UnitKind, ReactNode> = {
  cours: <BookOpen className="size-4" />,
  td: <ListChecks className="size-4" />,
  tp: <FlaskConical className="size-4" />,
  ei: <ClipboardCheck className="size-4" />,
  corrige: <CheckCircle2 className="size-4" />,
};

type Tab = 'td' | 'tp' | 'ei' | 'cours';

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

  const [tab, setTab] = useState<Tab | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [eiGenOpen, setEiGenOpen] = useState(false);
  const [launchEi, setLaunchEi] = useState<UnitDto | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  if (detail.isLoading) return <div className="p-8"><Spinner label="Chargement du cours…" /></div>;
  if (detail.error || !d) return <div className="p-8"><ErrorBox error={detail.error ?? 'Cours introuvable'} /></div>;

  const activeTab: Tab = tab ?? (byKind.tp.length ? 'tp' : byKind.td.length ? 'td' : byKind.ei.length ? 'ei' : 'cours');
  const inProgress = d.sessions.filter((s) => s.status !== 'done');
  const finished = d.sessions.filter((s) => s.status === 'done');
  const visibleJobs = d.jobs.filter((j) => j.type !== 'report' && j.type !== 'quiz');

  return (
    <div className="mx-auto max-w-[1300px] px-4 py-6 sm:px-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Mes cours
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-10 w-1.5 rounded-full" style={{ background: d.course.color }} />
          <h1 className="text-2xl font-semibold">{d.course.name}</h1>
          <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setSettingsOpen(true)} title="Modifier le cours">
            <Pencil className="size-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => setUploadOpen(true)}>
            Ajouter des fichiers
          </Button>
          <Button icon={<Sparkles className="size-4" />} onClick={() => setQuizOpen(true)} disabled={d.units.length === 0}>
            Quiz complet
          </Button>
          <Button icon={<ClipboardCheck className="size-4" />} onClick={() => setEiGenOpen(true)} disabled={byKind.ei.length === 0} title={byKind.ei.length === 0 ? 'Ajoute d’abord au moins une EI' : ''}>
            Générer une EI blanche
          </Button>
          <Button icon={<MessageCircleQuestion className="size-4" />} onClick={() => setChatOpen(true)}>
            Poser une question
          </Button>
        </div>
      </div>

      {visibleJobs.length > 0 && (
        <div className="mb-6">
          <JobList jobs={visibleJobs} documentsById={docNames} onChange={refresh} />
        </div>
      )}
      <ErrorBox error={startSession.error} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Colonne principale : parties détectées */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={activeTab}
              onChange={setTab}
              items={(['tp', 'td', 'ei', 'cours'] as Tab[]).map((k) => ({
                value: k,
                label: (
                  <>
                    {KIND_ICON[k]} {UNIT_KIND_LABELS[k]} <span className="text-xs text-muted">{byKind[k].length}</span>
                  </>
                ),
              }))}
            />
          </div>

          {d.units.length === 0 ? (
            <EmptyState icon={<FileUp className="size-8" />} title="Aucun contenu pour l’instant">
              Clique sur « Ajouter des fichiers » pour importer tes PDF. L’analyse détecte les chapitres de cours, TD, TP, EI et corrigés, même mélangés dans un seul fichier.
            </EmptyState>
          ) : activeTab === 'cours' ? (
            <CoursList units={byKind.cours} detail={d} />
          ) : byKind[activeTab].length === 0 ? (
            <EmptyState title={`Aucun ${UNIT_KIND_LABELS[activeTab]} détecté`}>Importe un PDF qui en contient, ou corrige le type d’une partie dans l’éditeur.</EmptyState>
          ) : (
            <div className="space-y-2.5">
              {byKind[activeTab].map((u) => (
                <UnitRow
                  key={u.id}
                  unit={u}
                  loading={startSession.isPending && startSession.variables?.unitId === u.id}
                  onLaunch={() => (u.kind === 'ei' ? setLaunchEi(u) : startSession.mutate({ unitId: u.id, mode: 'tp' }))}
                  inProgressId={inProgress.find((s) => s.unitId === u.id)?.id}
                />
              ))}
            </div>
          )}

          {byKind.corrige.length > 0 && (
            <details className="rounded-xl border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Corrigés détectés ({byKind.corrige.length})</summary>
              <div className="divide-y divide-border border-t border-border">
                {byKind.corrige.map((c) => {
                  const target = d.units.find((u) => u.id === c.correctsUnitId);
                  const matched = c.meta.solutions?.filter((s) => s.matchedQuestionId).length ?? 0;
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.title}</p>
                        <p className="text-xs text-muted">
                          {target ? `Rattaché à « ${target.title} » — ${matched}/${c.meta.solutions?.length ?? 0} solutions associées` : 'Non rattaché'}
                        </p>
                      </div>
                      <Link to={`/units/${c.id}/edit`} className="shrink-0 text-xs font-medium text-accent hover:underline">
                        Gérer
                      </Link>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        {/* Colonne latérale */}
        <div className="space-y-6">
          <section>
            <SectionTitle>Sessions</SectionTitle>
            {d.sessions.length === 0 ? (
              <p className="text-sm text-muted">Lance un TD, un TP ou une EI pour commencer.</p>
            ) : (
              <Card className="divide-y divide-border">
                {[...inProgress, ...finished].slice(0, 12).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.unitTitle}</p>
                      <p className="text-xs text-muted">
                        {s.status === 'in_progress' ? `En cours — ${s.progress.done}/${s.progress.total}` : s.status === 'reporting' ? 'Bilan en préparation…' : `Terminé${s.score !== null ? ` — ${s.score}/20` : ''}`}
                        {' · '}
                        {formatDate(s.updatedAt)}
                      </p>
                    </div>
                    {s.status === 'in_progress' ? (
                      <Button size="sm" variant="primary" onClick={() => navigate(`/sessions/${s.id}`)}>
                        Reprendre
                      </Button>
                    ) : s.reportId ? (
                      <Button size="sm" onClick={() => navigate(`/reports/${s.reportId}`)} icon={s.status === 'reporting' ? <Spinner /> : <ScrollText className="size-3.5" />}>
                        Bilan
                      </Button>
                    ) : (
                      <Spinner />
                    )}
                  </div>
                ))}
              </Card>
            )}
          </section>

          <section>
            <SectionTitle>Points bloquants</SectionTitle>
            <WeakPointsPanel points={d.weakPoints} onChange={refresh} />
          </section>

          <section>
            <SectionTitle>Quiz</SectionTitle>
            {d.quizzes.length === 0 ? (
              <p className="text-sm text-muted">Aucun quiz pour l’instant.</p>
            ) : (
              <Card className="divide-y divide-border">
                {d.quizzes.slice(0, 10).map((q) => (
                  <Link key={q.id} to={`/quizzes/${q.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{q.title}</p>
                      <p className="text-xs text-muted">{formatDate(q.createdAt)}</p>
                    </div>
                    {q.status === 'generating' ? (
                      <Spinner />
                    ) : q.status === 'error' ? (
                      <Badge tone="bad">Erreur</Badge>
                    ) : q.status === 'done' ? (
                      <Badge tone="ok">
                        {q.score}/{q.total}
                      </Badge>
                    ) : (
                      <Badge tone="accent">À faire</Badge>
                    )}
                  </Link>
                ))}
              </Card>
            )}
          </section>

          <section>
            <SectionTitle>Documents</SectionTitle>
            {d.documents.length === 0 ? (
              <p className="text-sm text-muted">Aucun document importé.</p>
            ) : (
              <Card className="divide-y divide-border">
                {d.documents.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onChange={refresh} />
                ))}
              </Card>
            )}
          </section>
        </div>
      </div>

      <UploadDialog courseId={d.course.id} open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} threadUrl={`/api/courses/${d.course.id}/chat`} subtitle={d.course.name} />
      <CourseQuizModal courseId={d.course.id} open={quizOpen} onClose={() => setQuizOpen(false)} />
      <GenerateEiModal detail={d} open={eiGenOpen} onClose={() => setEiGenOpen(false)} onDone={refresh} />
      <LaunchEiModal unit={launchEi} onClose={() => setLaunchEi(null)} loading={startSession.isPending} onLaunch={(mode, minutes) => startSession.mutate({ unitId: launchEi!.id, mode, timeLimitMinutes: minutes })} />
      <CourseSettingsModal detail={d} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function UnitRow({ unit, onLaunch, loading, inProgressId }: { unit: UnitDto; onLaunch: () => void; loading: boolean; inProgressId?: string }) {
  const navigate = useNavigate();
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{KIND_ICON[unit.kind]}</span>
        <div className="min-w-0">
          <p className="truncate font-medium">{unit.title}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{unit.questionCount} question(s)</Badge>
            {unit.documentName ? (
              <Badge>
                <FileText className="size-3" /> {unit.documentName} · p. {unit.pageStart}–{unit.pageEnd}
              </Badge>
            ) : unit.origin === 'generated' ? (
              <Badge tone="accent">
                <Sparkles className="size-3" /> Générée par l’IA
              </Badge>
            ) : null}
            {unit.hasCorrection && (
              <Badge tone="ok">
                <CheckCircle2 className="size-3" /> Corrigé disponible
              </Badge>
            )}
            {unit.kind === 'ei' && unit.meta.durationMinutes ? (
              <Badge>
                <Timer className="size-3" /> {unit.meta.durationMinutes} min
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => navigate(`/units/${unit.id}/edit`)}>
          Modifier
        </Button>
        {inProgressId ? (
          <Button size="sm" variant="primary" onClick={() => navigate(`/sessions/${inProgressId}`)} icon={<Play className="size-3.5" />}>
            Reprendre
          </Button>
        ) : (
          <Button size="sm" variant="primary" loading={loading} disabled={unit.questionCount === 0} onClick={onLaunch} icon={<Play className="size-3.5" />}>
            Lancer
          </Button>
        )}
      </div>
    </Card>
  );
}

function CoursList({ units, detail }: { units: UnitDto[]; detail: CourseDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  if (units.length === 0) return <EmptyState title="Aucun chapitre de cours détecté">Importe les PDF de cours : ils servent à l’aide « Partie de cours », au chat et aux quiz.</EmptyState>;
  return (
    <div className="space-y-2.5">
      {units.map((u) => {
        const sections = detail.sections.filter((s) => s.unitId === u.id);
        return (
          <Card key={u.id}>
            <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === u.id ? null : u.id)}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{KIND_ICON.cours}</span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.title}</p>
                  <p className="text-xs text-muted">
                    {sections.length} section(s){u.documentName ? ` · ${u.documentName} p. ${u.pageStart}–${u.pageEnd}` : ''}
                  </p>
                </div>
              </div>
              <ChevronDown className={clsx('size-4 shrink-0 text-muted transition-transform', open === u.id && 'rotate-180')} />
            </button>
            {open === u.id && (
              <div className="space-y-3 border-t border-border px-4 py-3">
                {sections.map((s) => (
                  <div key={s.id}>
                    <p className="text-sm font-medium">
                      {s.title} <span className="text-xs font-normal text-muted">p. {s.pageStart}–{s.pageEnd}</span>
                    </p>
                    <p className="text-sm text-muted">{s.summary}</p>
                    {s.keyConcepts.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.keyConcepts.slice(0, 8).map((k) => (
                          <Badge key={k}>{k}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <Link to={`/units/${u.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                  <Pencil className="size-3" /> Modifier ce chapitre
                </Link>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function DocumentRow({ doc, onChange }: { doc: CourseDetail['documents'][number]; onChange: () => void }) {
  const reanalyze = useMutation({ mutationFn: () => api.post(`/api/documents/${doc.id}/reanalyze`), onSuccess: onChange });
  const remove = useMutation({ mutationFn: () => api.del(`/api/documents/${doc.id}`), onSuccess: onChange });
  const confirmAction = async (action: 'reanalyze' | 'delete') => {
    const { count } = await api.get<{ count: number }>(`/api/documents/${doc.id}/sessions-count`);
    const warn = count ? `\n\nAttention : ${count} session(s) liée(s) à ce document seront supprimées.` : '';
    const msg = action === 'reanalyze' ? `Réanalyser « ${doc.filename} » ? Les parties détectées seront recréées.${warn}` : `Supprimer « ${doc.filename} » et tout son contenu ?${warn}`;
    if (confirm(msg)) (action === 'reanalyze' ? reanalyze : remove).mutate();
  };
  return (
    <div className="space-y-1 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm font-medium hover:underline">
          {doc.filename}
        </a>
        <div className="flex shrink-0 gap-1">
          <button className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" title="Réanalyser" onClick={() => confirmAction('reanalyze')}>
            <RefreshCw className="size-3.5" />
          </button>
          <button className="rounded p-1 text-muted hover:bg-surface-2 hover:text-bad" title="Supprimer" onClick={() => confirmAction('delete')}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">
        {doc.status === 'ready' ? `${doc.pageCount} pages · analysé` : doc.status === 'error' ? <span className="text-bad">{doc.error}</span> : doc.status === 'processing' ? 'Analyse en cours…' : 'En attente…'}
      </p>
    </div>
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
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} icon={<Sparkles className="size-4" />}>
            Générer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">Un mélange de QCM et de questions ouvertes sur tout le cours. Les points bloquants actifs sont travaillés en priorité (environ 60 % des questions).</p>
        <Tabs
          value={size}
          onChange={setSize}
          items={[
            { value: 'court', label: 'Court (10)' },
            { value: 'moyen', label: 'Moyen (20)' },
            { value: 'long', label: 'Long (30)' },
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
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} icon={<Sparkles className="size-4" />}>
            Générer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          L’IA s’inspire du style et du barème de tes EI importées, couvre le cours et donne la priorité à tes points bloquants. La nouvelle EI apparaîtra dans l’onglet EI.
        </p>
        <Field label="Difficulté">
          <Tabs
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
          <Field label="Chapitres à cibler (optionnel)">
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {chapters.flatMap((u) =>
                detail.sections
                  .filter((s) => s.unitId === u.id)
                  .map((s) => (
                    <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={sectionIds.includes(s.id)}
                        onChange={(e) => setSectionIds((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                      />
                      <span className="truncate">
                        <span className="text-muted">{u.title} · </span>
                        {s.title}
                      </span>
                    </label>
                  )),
              )}
            </div>
          </Field>
        )}
        <ErrorBox error={create.error} />
      </div>
    </Modal>
  );
}

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
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={loading} onClick={() => onLaunch(mode, Number(duration))} icon={<Play className="size-4" />}>
            Commencer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['ei_examen', 'Sans aide (examen)', 'Aucune aide ni chat, aucune correction pendant l’épreuve. Bilan et note sur 20 à la fin.'],
              ['ei_aides', 'Avec aides', 'Déroulé comme un TP (aides, vérification, chat), avec le chronomètre. Note sur 20 à la fin.'],
            ] as const
          ).map(([value, label, desc]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={clsx('rounded-xl border p-3 text-left transition-colors', mode === value ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2')}
            >
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1 text-xs text-muted">{desc}</p>
            </button>
          ))}
        </div>
        <Field label="Durée (minutes)" hint="Le chronomètre est sauvegardé : tu peux reprendre l’épreuve plus tard.">
          <input type="number" min={5} className={inputClass} value={minutes === '' ? duration : minutes} onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : '')} />
        </Field>
      </div>
    </Modal>
  );
}

function CourseSettingsModal({ detail, open, onClose }: { detail: CourseDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(detail.course.name);
  const [color, setColor] = useState(detail.course.color);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/courses/${detail.course.id}`, { name, color }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', detail.course.id] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/courses/${detail.course.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses'] });
      navigate('/');
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
            variant="danger"
            className="mr-auto"
            loading={remove.isPending}
            onClick={() => confirm(`Supprimer définitivement « ${detail.course.name} » et tout son contenu (documents, sessions, bilans, quiz) ?`) && remove.mutate()}
            icon={<Trash2 className="size-4" />}
          >
            Supprimer
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nom">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Couleur">
          <div className="flex flex-wrap gap-2">
            {COURSE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="size-8 rounded-full"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }}
                aria-label={`Couleur ${c}`}
              />
            ))}
          </div>
        </Field>
        <ErrorBox error={save.error ?? remove.error} />
      </div>
    </Modal>
  );
}
