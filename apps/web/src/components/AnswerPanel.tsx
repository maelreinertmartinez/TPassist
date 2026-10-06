import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import CodeMirror from '@uiw/react-codemirror';
import { CODE_LANGUAGES, type AnswerType, type CodeLanguage, type SubmitAttemptBody } from '@tpassist/shared';
import { Camera, Code2, ImagePlus, Type, X } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { imageFileToDataUrl } from '../lib/format';
import { Markdown } from './Markdown';
import { Button, Tabs } from './ui';

const LANG_EXT: Record<CodeLanguage, () => ReturnType<typeof python> | null> = {
  python: () => python(),
  c: () => cpp(),
  cpp: () => cpp(),
  java: () => java(),
  javascript: () => javascript(),
  sql: () => sql(),
  autre: () => null,
};

const LANG_LABEL: Record<CodeLanguage, string> = { python: 'Python', c: 'C', cpp: 'C++', java: 'Java', javascript: 'JavaScript', sql: 'SQL', autre: 'Autre' };

function usePrefersDark() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia('(prefers-color-scheme: dark)');
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

export interface AnswerDraft {
  type: AnswerType;
  text: string;
  code: string;
  codeLang: CodeLanguage;
  image: string | null;
}

export const emptyDraft = (): AnswerDraft => ({ type: 'text', text: '', code: '', codeLang: 'python', image: null });

export function draftToBody(questionId: string, d: AnswerDraft): SubmitAttemptBody {
  if (d.type === 'code') return { questionId, type: 'code', code: d.code, codeLang: d.codeLang };
  if (d.type === 'image') return { questionId, type: 'image', imageDataUrl: d.image ?? undefined, text: d.text || undefined };
  return { questionId, type: 'text', text: d.text };
}

export function AnswerPanel({
  draft,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  disabled,
}: {
  draft: AnswerDraft;
  onChange: (d: AnswerDraft) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  disabled?: boolean;
}) {
  const dark = usePrefersDark();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const ext = useMemo(() => {
    const e = LANG_EXT[draft.codeLang]();
    return e ? [e] : [];
  }, [draft.codeLang]);

  const loadImage = async (file?: File | null) => {
    if (!file) return;
    try {
      setImgError(null);
      onChange({ ...draft, image: await imageFileToDataUrl(file) });
    } catch (e) {
      setImgError(e instanceof Error ? e.message : String(e));
    }
  };

  const canSubmit = draft.type === 'text' ? draft.text.trim().length > 0 : draft.type === 'code' ? draft.code.trim().length > 0 : Boolean(draft.image);

  return (
    <div className="space-y-3">
      <Tabs
        value={draft.type}
        onChange={(type) => onChange({ ...draft, type })}
        items={[
          { value: 'text', label: (<><Type className="size-3.5" /> Texte / LaTeX</>) },
          { value: 'code', label: (<><Code2 className="size-3.5" /> Code</>) },
          { value: 'image', label: (<><Camera className="size-3.5" /> Photo</>) },
        ]}
      />

      {draft.type === 'text' && (
        <div className="space-y-2">
          <textarea
            value={draft.text}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSubmit) onSubmit();
            }}
            rows={9}
            placeholder={'Rédige ta réponse. Formules en LaTeX : $AB = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$\n(Ctrl+Entrée pour valider)'}
            className="w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-3 font-mono text-sm leading-relaxed focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
          />
          {draft.text.trim() && (
            <div className="rounded-xl border border-dashed border-border bg-surface-2/60 px-3.5 py-2.5">
              <p className="mb-1 text-xs font-medium text-muted">Aperçu</p>
              <Markdown className="text-sm">{draft.text}</Markdown>
            </div>
          )}
        </div>
      )}

      {draft.type === 'code' && (
        <div className="space-y-2">
          <select
            value={draft.codeLang}
            onChange={(e) => onChange({ ...draft, codeLang: e.target.value as CodeLanguage })}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
          <div className="overflow-hidden rounded-xl border border-border">
            <CodeMirror
              value={draft.code}
              height="280px"
              theme={dark ? 'dark' : 'light'}
              extensions={ext}
              editable={!disabled}
              onChange={(code) => onChange({ ...draft, code })}
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
            />
          </div>
        </div>
      )}

      {draft.type === 'image' && (
        <div className="space-y-2" onPaste={(e) => loadImage([...e.clipboardData.files].find((f) => f.type.startsWith('image/')))} tabIndex={0}>
          {draft.image ? (
            <div className="relative">
              <img src={draft.image} alt="Ta copie" className="max-h-96 w-full rounded-xl border border-border object-contain" />
              <button className="absolute top-2 right-2 rounded-full bg-surface p-1 shadow" onClick={() => onChange({ ...draft, image: null })} aria-label="Retirer la photo">
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-10 text-center">
              <ImagePlus className="size-7 text-muted" />
              <p className="text-sm text-muted">Prends en photo ta copie manuscrite, ou colle une image (Ctrl+V).</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => fileInput.current?.click()} icon={<ImagePlus className="size-3.5" />}>
                  Choisir une image
                </Button>
                <Button size="sm" onClick={() => cameraInput.current?.click()} icon={<Camera className="size-3.5" />}>
                  Appareil photo
                </Button>
              </div>
            </div>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => loadImage(e.target.files?.[0])} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => loadImage(e.target.files?.[0])} />
          <input
            value={draft.text}
            onChange={(e) => onChange({ ...draft, text: e.target.value })}
            placeholder="Commentaire optionnel (ex. « le résultat est en bas de page »)"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          {imgError && <p className="text-sm text-bad">{imgError}</p>}
        </div>
      )}

      <Button variant="primary" className="w-full" disabled={!canSubmit || disabled} loading={submitting} onClick={onSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}
