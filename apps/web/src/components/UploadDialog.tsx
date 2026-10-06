import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { FileText, FileUp, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button, ErrorBox, IconButton, Modal } from './ui';

export function UploadDialog({ courseId, open, onClose, onUploaded }: { courseId: string; open: boolean; onClose: () => void; onUploaded: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      for (const f of files) form.append('files', f, f.name);
      return api.upload(`/api/courses/${courseId}/documents`, form);
    },
    onSuccess: () => {
      setFiles([]);
      onUploaded();
      onClose();
    },
  });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const pdfs = [...list].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    setFiles((cur) => [...cur, ...pdfs.filter((p) => !cur.some((c) => c.name === p.name && c.size === p.size))]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter des fichiers"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={files.length === 0} loading={upload.isPending} onClick={() => upload.mutate()}>
            Importer et analyser {files.length > 0 && `(${files.length})`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">Cours, TD, TP, corrigés ou EI : un même PDF peut tout mélanger, l’IA repère chaque partie.</p>
        <button
          type="button"
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => input.current?.click()}
          className={clsx(
            'flex w-full flex-col items-center justify-center gap-3 rounded-lg px-4 py-12 text-center transition-colors',
            drag ? 'bg-tint-blue text-tint-blue-ink' : 'bg-block text-ink-2 hover:bg-hover',
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-page text-accent shadow-e1">
            <FileUp className="size-6" />
          </span>
          <span className="text-sm font-semibold">Glisse tes PDF ici</span>
          <span className="text-xs text-ink-3">ou clique pour les choisir</span>
        </button>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.name + f.size} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-hover">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-ink-4" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-ink-3">{(f.size / 1024 / 1024).toFixed(1)} Mo</span>
                </span>
                <IconButton label="Retirer" onClick={() => setFiles((cur) => cur.filter((c) => c !== f))}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <ErrorBox error={upload.error} />
      </div>
    </Modal>
  );
}
