import { useMutation } from '@tanstack/react-query';
import { FileUp, FileText, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button, ErrorBox, Modal } from './ui';

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
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={files.length === 0} loading={upload.isPending} onClick={() => upload.mutate()} icon={<FileUp className="size-4" />}>
            Importer et analyser
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Ajoute des PDF de cours, de TD, de TP, de corrigés ou d’EI. Un même PDF peut mélanger plusieurs types : l’IA détectera chaque partie.
        </p>
        <div
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
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            drag ? 'border-accent bg-accent-soft' : 'border-border hover:border-accent'
          }`}
        >
          <FileUp className="size-7 text-muted" />
          <span className="text-sm font-medium">Glisse tes PDF ici ou clique pour choisir</span>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        </div>
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.name + f.size} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted">{(f.size / 1024 / 1024).toFixed(1)} Mo</span>
                </span>
                <button className="text-muted hover:text-bad" onClick={() => setFiles((cur) => cur.filter((c) => c !== f))} aria-label="Retirer">
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <ErrorBox error={upload.error} />
      </div>
    </Modal>
  );
}
