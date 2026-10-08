// Données d'un cours (page du cours et page d'un document), rechargées toutes les 2 s tant que quelque chose
// travaille en fond : tâche, bilan, quiz ou analyse d'un PDF.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourseDetail } from '@tpassist/shared';
import { api } from './api';

/** Vrai si une tâche, un bilan, un quiz ou une analyse de PDF est en cours. */
function isBusy(d: CourseDetail): boolean {
  return (
    d.jobs.some((j) => j.status === 'queued' || j.status === 'running') ||
    d.sessions.some((s) => s.status === 'reporting') ||
    d.quizzes.some((x) => x.status === 'generating') ||
    d.documents.some((x) => x.status === 'pending' || x.status === 'processing')
  );
}

/** Détail d'un cours et `refresh` pour le recharger après une modification. */
export function useCourseDetail(courseId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api.get<CourseDetail>(`/api/courses/${courseId}`),
    enabled: Boolean(courseId),
    refetchInterval: (q) => (q.state.data && isBusy(q.state.data) ? 2000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['course', courseId] });
  return { ...query, refresh };
}
