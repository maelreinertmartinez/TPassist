import { useQuery } from '@tanstack/react-query';
import type { ChatMessageDto, ChatThreadDto } from '@tpassist/shared';
import clsx from 'clsx';
import { ImagePlus, MessageCircleQuestion, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { imageFileToDataUrl } from '../lib/format';
import { postSse } from '../lib/sse';
import { Markdown } from './Markdown';
import { ErrorBox, Spinner } from './ui';

export function ChatPanel({ open, onClose, threadUrl, subtitle, onSent }: { open: boolean; onClose: () => void; threadUrl: string; subtitle: string; onSent?: () => void }) {
  const thread = useQuery({ queryKey: ['chat', threadUrl], queryFn: () => api.get<ChatThreadDto>(threadUrl), enabled: open });
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [pending, setPending] = useState<{ user: string; image: string | null; reply: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [thread.data?.messages.length, pending?.reply, open]);

  const send = async () => {
    const t = text.trim();
    if (!t || !thread.data || pending) return;
    setError(null);
    setPending({ user: t, image, reply: '' });
    setText('');
    const img = image;
    setImage(null);
    try {
      await postSse<ChatMessageDto>(
        `/api/chat/threads/${thread.data.id}/messages`,
        { text: t, imageDataUrl: img },
        { onDelta: (d) => setPending((p) => (p ? { ...p, reply: p.reply + d } : p)) },
      );
      await thread.refetch();
      onSent?.();
    } catch (err) {
      setError(errorMessage(err));
      setText(t);
      setImage(img);
    } finally {
      setPending(null);
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      setImage(await imageFileToDataUrl(file));
    }
  };

  const disabled = thread.data?.disabled;

  return (
    <aside
      className={clsx(
        'no-print fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-200',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <MessageCircleQuestion className="size-4 text-accent" /> Poser une question
          </p>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <button className="rounded-md p-1 text-muted hover:bg-surface-2" onClick={onClose} aria-label="Fermer">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {thread.isLoading && <Spinner label="Chargement…" />}
        {thread.error && <ErrorBox error={thread.error} />}
        {thread.data && thread.data.messages.length === 0 && !pending && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
            Pose une question sur le cours ou sur le sujet ouvert. L’IA respecte les verrous : elle ne donne ni l’indice ni la solution de la question en cours avant qu’ils soient débloqués.
          </p>
        )}
        {thread.data?.messages.map((m) => <Bubble key={m.id} role={m.role} text={m.contentMd} image={m.imageUrl} />)}
        {pending && (
          <>
            <Bubble role="user" text={pending.user} image={pending.image} />
            {pending.reply ? <Bubble role="assistant" text={pending.reply} /> : <Spinner label="L’IA réfléchit…" />}
          </>
        )}
        {error && <ErrorBox error={error} />}
        <div ref={bottom} />
      </div>

      <div className="border-t border-border p-3">
        {disabled ? (
          <p className="text-center text-sm text-muted">Le chat est désactivé pendant une EI en mode examen.</p>
        ) : (
          <div className="space-y-2">
            {image && (
              <div className="relative inline-block">
                <img src={image} alt="Pièce jointe" className="h-16 rounded-md border border-border" />
                <button className="absolute -top-2 -right-2 rounded-full bg-surface p-0.5 shadow" onClick={() => setImage(null)} aria-label="Retirer l’image">
                  <X className="size-3" />
                </button>
              </div>
            )}
            {preview && text.trim() ? (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                <Markdown>{text}</Markdown>
              </div>
            ) : null}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={3}
              placeholder="Ta question… (LaTeX avec $...$, Entrée pour envoyer)"
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => fileInput.current?.click()} title="Joindre une image">
                  <ImagePlus className="size-4" />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setImage(await imageFileToDataUrl(f));
                    e.target.value = '';
                  }}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Aperçu
                </label>
              </div>
              <button
                onClick={send}
                disabled={!text.trim() || Boolean(pending)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                <Send className="size-3.5" /> Envoyer
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function Bubble({ role, text, image }: { role: 'user' | 'assistant'; text: string; image?: string | null }) {
  return (
    <div className={clsx('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div className={clsx('max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm', role === 'user' ? 'bg-accent-soft' : 'border border-border bg-surface-2')}>
        {image && <img src={image} alt="" className="mb-2 max-h-40 rounded-md" />}
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
}
