// Chat « Poser une question » dans un tiroir latéral : texte (LaTeX avec aperçu) et image collée ou jointe.
// La réponse du tuteur est diffusée au fil de l'eau.
import { useQuery } from '@tanstack/react-query';
import type { ChatMessageDto, ChatThreadDto } from '@tpassist/shared';
import { Eye, ImagePlus, MessageCircleQuestion, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { imageFileToDataUrl, imageFromClipboard } from '../lib/images';
import { postSse } from '../lib/sse';
import { Markdown } from './Markdown';
import { Callout, Drawer, ErrorBox, IconButton, Spinner } from './ui';

/**
 * @param threadUrl route qui renvoie (et crée au besoin) la conversation : celle du cours ou celle de la séance
 * @param onSent appelé après chaque réponse (la séance compte les questions posées)
 */
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
    const file = imageFromClipboard(e);
    if (file) {
      e.preventDefault();
      setImage(await imageFileToDataUrl(file));
    }
  };

  return (
    <Drawer open={open} onClose={onClose} label="Poser une question">
      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircleQuestion className="size-4 text-accent" /> Poser une question
          </p>
          <p className="truncate text-xs text-ink-3">{subtitle}</p>
        </div>
        <IconButton label="Fermer" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {thread.isLoading && <Spinner label="Chargement…" />}
        {thread.error && <ErrorBox error={thread.error} />}
        {thread.data && thread.data.messages.length === 0 && !pending && (
          <Callout tone="blue" icon={<Sparkles className="size-4" />}>
            <p className="text-sm">
              Pose une question sur le cours ou sur le sujet ouvert. L’IA respecte les verrous : elle ne donne ni l’indication ni la solution de la question en cours avant leur déblocage.
            </p>
          </Callout>
        )}
        {thread.data?.messages.map((m) => <Message key={m.id} role={m.role} text={m.contentMd} image={m.imageUrl} />)}
        {pending && (
          <>
            <Message role="user" text={pending.user} image={pending.image} />
            {pending.reply ? <Message role="assistant" text={pending.reply} /> : <Spinner label="L’IA réfléchit…" />}
          </>
        )}
        {error && <ErrorBox error={error} />}
        <div ref={bottom} />
      </div>

      <div className="p-4">
        {thread.data?.disabled ? (
          <p className="text-center text-sm text-ink-3">Le chat est désactivé pendant une EI en mode examen.</p>
        ) : (
          <div className="rounded-lg bg-block p-2 focus-within:ring-2 focus-within:ring-accent">
            {image && (
              <div className="relative mb-2 inline-block">
                <img src={image} alt="Pièce jointe" className="h-16 rounded" />
                <button
                  type="button"
                  aria-label="Retirer l’image"
                  className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-page text-ink-3 shadow-e1 hover:text-ink"
                  onClick={() => setImage(null)}
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
            {preview && text.trim() && (
              <div className="mb-2 max-h-32 overflow-y-auto rounded bg-page px-3 py-2">
                <Markdown className="text-sm">{text}</Markdown>
              </div>
            )}
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
              placeholder="Ta question… (LaTeX : $...$ · Entrée pour envoyer)"
              className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 placeholder:text-ink-4 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <IconButton label="Joindre une image" onClick={() => fileInput.current?.click()}>
                  <ImagePlus className="size-4" />
                </IconButton>
                <IconButton label={preview ? 'Masquer l’aperçu' : 'Aperçu LaTeX'} onClick={() => setPreview(!preview)} active={preview}>
                  <Eye className="size-4" />
                </IconButton>
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
              </div>
              <button
                type="button"
                onClick={send}
                disabled={!text.trim() || Boolean(pending)}
                aria-label="Envoyer"
                className="grid size-8 place-items-center rounded bg-accent text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Message({ role, text, image }: { role: 'user' | 'assistant'; text: string; image?: string | null }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-sm rounded-lg bg-block px-3 py-2 text-sm">
          {image && <img src={image} alt="" className="mb-2 max-h-48 rounded" />}
          <Markdown>{text}</Markdown>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-blue-icon">
        <Sparkles className="size-3" />
      </span>
      <Markdown className="min-w-0 flex-1 text-sm">{text}</Markdown>
    </div>
  );
}
