// Fenêtre d'ajout d'une partie à partir des pages choisies : type et titre, puis extraction par l'IA en tâche de fond.
import { useMutation } from '@tanstack/react-query';
import { UNIT_KIND_LABELS, UNIT_KINDS, type AddUnitFromPagesBody, type DocumentDto, type JobDto, type UnitDto, type UnitKind } from '@tpassist/shared';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, ErrorBox, Field, Modal, Segmented, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { formatPageRange, plural } from '../../lib/format';
import type { PageRange } from './PageGrid';

/** Ce que l'IA fera des pages, selon le type de partie. */
const KIND_HINTS: Record<UnitKind, string> = {
  cours: 'Les sections du chapitre seront transcrites ; la carte des notions proposera ensuite de se mettre à jour.',
  td: 'Les exercices et leurs questions seront transcrits, prêts à être lancés en séance.',
  tp: 'Les exercices et leurs questions seront transcrits, prêts à être lancés en séance.',
  ei: 'Les exercices et leurs questions seront transcrits, avec le barème et la durée s’ils figurent sur les pages.',
  corrige: 'Les solutions seront transcrites puis rattachées automatiquement à leur sujet (modifiable dans l’éditeur).',
};

/**
 * @param units toutes les parties du cours (pour proposer un titre numéroté à la suite)
 * @param onCreated appelé une fois l'extraction lancée
 */
export function AddUnitModal({
  document,
  selection,
  units,
  open,
  onClose,
  onCreated,
}: {
  document: DocumentDto;
  selection: PageRange | null;
  units: UnitDto[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const suggestedTitle = (k: UnitKind) => `${UNIT_KIND_LABELS[k]} ${units.filter((u) => u.kind === k).length + 1}`;
  const [kind, setKind] = useState<UnitKind>('td');
  const [title, setTitle] = useState('');
  // Le titre proposé suit le type tant que l'utilisateur ne l'a pas modifié.
  const [titleEdited, setTitleEdited] = useState(false);
  const create = useMutation({
    mutationFn: (body: AddUnitFromPagesBody) => api.post<JobDto>(`/api/documents/${document.id}/units`, body),
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });
  useEffect(() => {
    if (!open) return;
    setKind('td');
    setTitle(suggestedTitle('td'));
    setTitleEdited(false);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changeKind = (k: UnitKind) => {
    setKind(k);
    if (!titleEdited) setTitle(suggestedTitle(k));
  };
  const submit = () => selection && create.mutate({ kind, title, pageStart: selection.start, pageEnd: selection.end });
  const pageCount = selection ? selection.end - selection.start + 1 : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter une partie"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={!title.trim() || !selection} loading={create.isPending} onClick={submit}>
            Lancer l’extraction
          </Button>
        </>
      }
    >
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) submit();
        }}
      >
        <p className="text-sm text-ink-2">
          {plural(pageCount, 'page')} ({selection && formatPageRange(selection.start, selection.end)}) de « {document.filename} ». L’IA les transcrit en tâche de fond : la
          partie apparaîtra dans le cours une fois prête.
        </p>
        <Field label="Type">
          <Segmented value={kind} onChange={changeKind} items={UNIT_KINDS.map((k) => ({ value: k, label: UNIT_KIND_LABELS[k] }))} />
        </Field>
        <Field label="Titre" hint={KIND_HINTS[kind]}>
          <TextInput
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleEdited(true);
            }}
          />
        </Field>
        <ErrorBox error={create.error} />
      </form>
    </Modal>
  );
}
