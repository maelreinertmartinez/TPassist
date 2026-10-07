// Saisie d'une réponse : texte avec LaTeX (aperçu en direct), code (éditeur avec coloration) ou photo de copie.
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import CodeMirror from '@uiw/react-codemirror';
import { CODE_LANGUAGES, type AnswerType, type CodeLanguage, type SubmitAttemptBody } from '@tpassist/shared';
import { Camera, Code2, Eye, ImagePlus, Type, X } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../lib/api';
import { imageFileToDataUrl, imageFromClipboard } from '../lib/images';
import { Markdown } from './Markdown';
import { Button, IconButton, inputClass, Segmented } from './ui';

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

/** Suit le thème clair/sombre du système (pour l'éditeur de code). */
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

/** Brouillon de réponse, gardé par question tant qu'il n'est pas envoyé. */
export interface AnswerDraft {
  type: AnswerType;
  text: string;
  code: string;
  codeLang: CodeLanguage;
  /** Photo réduite, en data URL JPEG. */
  image: string | null;
}

/** Brouillon vide (réponse texte, code Python par défaut). */
export const emptyDraft = (): AnswerDraft => ({ type: 'text', text: '', code: '', codeLang: 'python', image: null });

/** Corps de la requête d'envoi d'une réponse (seul le type choisi est envoyé). */
export function draftToBody(questionId: string, d: AnswerDraft): SubmitAttemptBody {
  if (d.type === 'code') return { questionId, type: 'code', code: d.code, codeLang: d.codeLang };
  if (d.type === 'image') return { questionId, type: 'image', imageDataUrl: d.image ?? undefined, text: d.text || undefined };
  return { questionId, type: 'text', text: d.text };
}

/** Le brouillon contient une réponse non vide du type choisi. */
export function canSubmitDraft(d: AnswerDraft) {
  return d.type === 'text' ? d.text.trim().length > 0 : d.type === 'code' ? d.code.trim().length > 0 : Boolean(d.image);
}

/**
 * Éditeur de réponse qui remplit toute la hauteur disponible (le parent est une colonne flex).
 * Le bouton de validation est rendu par le parent, épinglé en bas du panneau.
 */
export function AnswerPanel({ draft, onChange, onSubmit }: { draft: AnswerDraft; onChange: (d: AnswerDraft) => void; onSubmit: () => void }) {
  const dark = usePrefersDark();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [preview, setPreview] = useState(true);
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
      setImgError(errorMessage(e));
    }
  };

  const showPreview = preview && draft.type === 'text' && draft.text.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={draft.type}
          onChange={(type) => onChange({ ...draft, type })}
          items={[
            { value: 'text', label: (<><Type className="size-4" /> Texte</>) },
            { value: 'code', label: (<><Code2 className="size-4" /> Code</>) },
            { value: 'image', label: (<><Camera className="size-4" /> Photo</>) },
          ]}
        />
        {draft.type === 'text' && (
          <IconButton label={preview ? 'Masquer l’aperçu' : 'Afficher l’aperçu'} onClick={() => setPreview(!preview)} active={preview}>
            <Eye className="size-4" />
          </IconButton>
        )}
        {draft.type === 'code' && (
          <select
            value={draft.codeLang}
            onChange={(e) => onChange({ ...draft, codeLang: e.target.value as CodeLanguage })}
            className="h-8 rounded bg-block px-2 text-sm text-ink focus:outline-accent"
            aria-label="Langage"
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
        )}
      </div>

      {draft.type === 'text' && (
        <>
          <textarea
            value={draft.text}
            onChange={(e) => onChange({ ...draft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSubmitDraft(draft)) onSubmit();
            }}
            placeholder={'Rédige ta réponse ici.\nFormules en LaTeX : $AB = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$\nCtrl + Entrée pour valider.'}
            className="min-h-48 flex-1 resize-none rounded-lg bg-block px-4 py-3 font-mono text-sm leading-6 text-ink placeholder:text-ink-4 focus:bg-page focus:ring-2 focus:ring-accent focus:outline-none"
          />
          {showPreview && (
            <div className="max-h-48 shrink-0 overflow-y-auto rounded-lg px-4 py-3 ring-1 ring-line">
              <p className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Aperçu</p>
              <Markdown className="text-sm">{draft.text}</Markdown>
            </div>
          )}
        </>
      )}

      {draft.type === 'code' && (
        <div className="relative min-h-48 flex-1 overflow-hidden rounded-lg ring-1 ring-line">
          <div className="absolute inset-0">
            <CodeMirror
              value={draft.code}
              height="100%"
              theme={dark ? 'dark' : 'light'}
              extensions={ext}
              onChange={(code) => onChange({ ...draft, code })}
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
            />
          </div>
        </div>
      )}

      {draft.type === 'image' && (
        <div
          className="flex min-h-48 flex-1 flex-col gap-3"
          onPaste={(e) => loadImage(imageFromClipboard(e))}
          tabIndex={0}
        >
          {draft.image ? (
            <div className="relative min-h-0 flex-1 rounded-lg bg-block">
              <img src={draft.image} alt="Ta copie" className="absolute inset-0 size-full object-contain p-2" />
              <IconButton label="Retirer la photo" className="absolute top-2 right-2 bg-page shadow-e1" onClick={() => onChange({ ...draft, image: null })}>
                <X className="size-4" />
              </IconButton>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-block px-4 py-8 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-tint-blue text-tint-blue-icon">
                <ImagePlus className="size-6" />
              </span>
              <p className="max-w-xs text-sm text-ink-3">Prends ta copie en photo, ou colle une image avec Ctrl + V.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="raised" onClick={() => fileInput.current?.click()} icon={<ImagePlus className="size-4" />}>
                  Choisir une image
                </Button>
                <Button variant="raised" onClick={() => cameraInput.current?.click()} icon={<Camera className="size-4" />}>
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
            placeholder="Commentaire (optionnel) : « le résultat est en bas de page »"
            className={inputClass}
          />
          {imgError && <p className="text-sm text-red-600">{imgError}</p>}
        </div>
      )}
    </div>
  );
}
