// Onglet « Documents » : les PDF du cours, avec leur réanalyse et leur suppression (après confirmation).
import { useMutation } from '@tanstack/react-query';
import type { CourseDetail } from '@tpassist/shared';
import { AlertCircle, FileText, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import { Button, EmptyState, IconButton, useConfirm } from '../../components/ui';
import { api } from '../../lib/api';
import { Row } from './common';

/**
 * @param onChange appelé après une réanalyse ou une suppression
 * @param onAdd ouvre la fenêtre d'ajout de fichiers
 */
export function Documents({ detail, onChange, onAdd }: { detail: CourseDetail; onChange: () => void; onAdd: () => void }) {
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
