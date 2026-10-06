import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../components/ui';
import { api } from './api';

/** Suppression d'un cours, toujours après confirmation (tuiles du tableau de bord, page du cours). */
export function useDeleteCourse() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/courses/${id}`),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: ['course', id] });
      qc.removeQueries({ queryKey: ['notions', id] });
      void qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });

  const ask = async (course: { id: string; name: string }, onDeleted?: () => void) => {
    const ok = await confirm({
      title: `Supprimer « ${course.name} » ?`,
      message: 'Ses documents, chapitres, TD/TP, EI, séances, bilans, quiz, points bloquants et sa carte des notions seront supprimés définitivement.',
      confirmLabel: 'Supprimer le cours',
      danger: true,
    });
    if (ok) remove.mutate(course.id, { onSuccess: () => onDeleted?.() });
  };

  return { ask, deletingId: remove.isPending ? remove.variables : undefined, error: remove.error };
}
