// Fusion d'une autre partie de même nature dans celle éditée (ses exercices ou sections sont ajoutés à la fin).
import { useMutation } from '@tanstack/react-query';
import { UNIT_KIND_LABELS, isPlayableKind, type EditorUnit } from '@tpassist/shared';
import { useState } from 'react';
import { Button, ErrorBox, inputClass, Modal } from '../../components/ui';
import { api } from '../../lib/api';
import type { OnSaved } from './common';

/** Fenêtre de fusion d’une autre partie dans celle-ci. */
export function MergeModal({ data, open, onClose, onSaved }: { data: EditorUnit; open: boolean; onClose: () => void; onSaved: OnSaved }) {
  const isCours = data.unit.kind === 'cours';
  const candidates = data.siblings.filter((s) => (isCours ? s.kind === 'cours' : isPlayableKind(s.kind)));
  const [source, setSource] = useState('');
  const merge = useMutation({
    mutationFn: () => api.post<EditorUnit>(`/api/units/${data.unit.id}/merge`, { sourceId: source }),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fusionner une autre partie ici"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!source} loading={merge.isPending} onClick={() => merge.mutate()}>
            Fusionner
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Les {isCours ? 'sections' : 'exercices'} de la partie choisie sont ajoutés à la fin de « {data.unit.title} », puis la partie choisie est supprimée.
        </p>
        <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Partie à fusionner">
          <option value="">Choisir une partie</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {UNIT_KIND_LABELS[c.kind]} · {c.title}
            </option>
          ))}
        </select>
        <ErrorBox error={merge.error} />
      </div>
    </Modal>
  );
}
