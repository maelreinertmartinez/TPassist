// Page d'un cours : en-tête (icône, nom, actions), reprise de la dernière séance, tâches en cours et onglets
// dans l'ordre du parcours (cours, notions, TD & TP, EI, points bloquants, historique, documents).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourseDetail, SessionMode, UnitDto, UnitKind } from '@tpassist/shared';
import { FileUp, Play } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatPanel } from '../../components/ChatPanel';
import { JobList } from '../../components/JobList';
import { UploadDialog } from '../../components/UploadDialog';
import { WeakPointsPanel } from '../../components/WeakPointsPanel';
import { Button, Callout, EmptyState, ErrorBox, Page, Spinner, ViewTabs } from '../../components/ui';
import { api } from '../../lib/api';
import { useBreadcrumbs } from '../../lib/breadcrumbs';
import { plural } from '../../lib/format';
import { Count } from './common';
import { CourseHeader } from './CourseHeader';
import { CoursList } from './CoursList';
import { DetectedCorrections } from './DetectedCorrections';
import { Documents } from './Documents';
import { History } from './History';
import { CourseQuizModal, CourseSettingsModal, GenerateEiModal, LaunchEiModal } from './modals';
import { NotionsTab } from './notions/NotionsTab';
import { UnitList } from './UnitList';

type Tab = 'cours' | 'notions' | 'exercices' | 'ei' | 'points' | 'historique' | 'documents';

/** Page d’un cours (route /courses/:courseId). */
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
      <CourseHeader
        detail={d}
        counts={{ chapters: byKind.cours.length, exercises: exercises.length, ei: byKind.ei.length }}
        onSettings={() => setSettingsOpen(true)}
        onUpload={() => setUploadOpen(true)}
        onQuiz={() => setQuizOpen(true)}
        onGenerateEi={() => setEiGenOpen(true)}
        onChat={() => setChatOpen(true)}
      />

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
              {plural(resume.progress.done, 'question terminée', 'questions terminées')} sur {resume.progress.total}
              {inProgress.length > 1 && ` · ${inProgress.length - 1} autre(s) séance(s) en cours dans l’historique`}
            </p>
          </Callout>
        )}
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
                <DetectedCorrections corriges={byKind.corrige} units={d.units} />
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
