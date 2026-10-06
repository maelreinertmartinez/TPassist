import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NOTION_KIND_LABELS, type NotionDetailDto, type NotionDto, type WeakPointDto } from '@tpassist/shared';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { postSse } from '../lib/sse';
import { Markdown } from './Markdown';
import { Callout, ErrorBox, IconButton, SectionLabel, Spinner, Tag, TextAction, Toggle } from './ui';

interface Props {
  notion: NotionDto | null;
  byId: Map<string, NotionDto>;
  dependants: Map<string, string[]>;
  chapterTitle: string;
  weakPoints: WeakPointDto[];
  courseId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Panneau latéral : fiche complète d'une notion (rédigée par l'IA au premier clic, puis en cache). */
export function NotionDrawer({ notion, byId, dependants, chapterTitle, weakPoints, courseId, onSelect, onClose }: Props) {
  const qc = useQueryClient();
  const open = Boolean(notion);
  const id = notion?.id;
  const detail = useQuery({ queryKey: ['notion', id], queryFn: () => api.get<NotionDetailDto>(`/api/notions/${id}`), enabled: Boolean(id) });
  const [stream, setStream] = useState<{ id: string; text: string; pending: boolean; error: string | null } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const write = async (notionId: string, refresh: boolean) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStream({ id: notionId, text: '', pending: true, error: null });
    try {
      const r = await postSse<{ detailMd: string }>(
        `/api/notions/${notionId}/detail`,
        { refresh },
        { signal: ctrl.signal, onDelta: (d) => setStream((s) => (s && s.id === notionId ? { ...s, text: s.text + d } : s)) },
      );
      qc.setQueryData<NotionDetailDto>(['notion', notionId], (d) => (d ? { ...d, detailMd: r.detailMd } : d));
      void qc.invalidateQueries({ queryKey: ['notions', courseId] });
      setStream((s) => (s && s.id === notionId ? null : s));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStream((s) => (s && s.id === notionId ? { ...s, pending: false, error: errorMessage(err) } : s));
    }
  };

  // Première ouverture d'une notion sans fiche : on la fait rédiger.
  useEffect(() => {
    if (!detail.data || detail.data.id !== id || detail.data.detailMd || stream?.id === id) return;
    void write(detail.data.id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, id]);

  // Changement de notion : on remonte en haut du panneau.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => () => abort.current?.abort(), []);

  const current = stream && stream.id === id ? stream : null;
  const cached = detail.data && detail.data.id === id ? detail.data.detailMd : null;
  const sheet = current ? current.text : (cached ?? '');
  const parent = notion?.parentId ? byId.get(notion.parentId) : undefined;
  const chips = (ids: string[]) => ids.map((x) => byId.get(x)).filter((x): x is NotionDto => Boolean(x));
  const prerequisites = notion ? chips(notion.prerequisiteIds) : [];
  const usedBy = notion ? chips(dependants.get(notion.id) ?? []) : [];
  const children = notion ? [...byId.values()].filter((n) => n.parentId === notion.id).sort((a, b) => a.order - b.order) : [];
  const weak = notion ? weakPoints.filter((w) => notion.weakPointIds.includes(w.id)) : [];

  return (
    <aside
      className={`no-print fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col bg-raised shadow-e4 transition-transform duration-200 ${open ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
      aria-hidden={!open}
      aria-label="Détail de la notion"
      inert={!open}
    >
      {notion && (
        <>
          <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div className="min-w-0">
              <p className="truncate text-xs text-ink-3">
                {chapterTitle}
                {parent && (
                  <>
                    {' › '}
                    <button type="button" className="hover:text-ink hover:underline" onClick={() => onSelect(parent.id)}>
                      {parent.title}
                    </button>
                  </>
                )}
              </p>
              <h2 className="mt-1 text-xl leading-tight font-semibold">{notion.title}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <Tag>{NOTION_KIND_LABELS[notion.kind]}</Tag>
                {weak.length > 0 && (
                  <Tag tone="red">
                    <AlertTriangle className="size-3" /> Point bloquant
                  </Tag>
                )}
              </div>
            </div>
            <IconButton label="Fermer" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </header>

          <div ref={body} className="flex-1 space-y-8 overflow-y-auto px-6 pb-12">
            {notion.summary && <p className="max-w-[65ch] text-sm text-ink-2">{notion.summary}</p>}

            {weak.length > 0 && (
              <Callout tone="red" icon={<AlertTriangle className="size-4" />} title="Tu as déjà bloqué sur cette notion">
                <ul className="space-y-1 text-sm">
                  {weak.map((w) => (
                    <li key={w.id}>{w.notion}</li>
                  ))}
                </ul>
              </Callout>
            )}

            <section>
              <SectionLabel
                actions={
                  sheet && !current?.pending ? (
                    <TextAction icon={<RefreshCw className="size-4" />} onClick={() => write(notion.id, true)}>
                      Réécrire la fiche
                    </TextAction>
                  ) : undefined
                }
              >
                Fiche
              </SectionLabel>
              {detail.isLoading && <Spinner label="Chargement…" />}
              <ErrorBox error={detail.error} />
              {sheet && <Markdown>{sheet}</Markdown>}
              {current?.pending && <Spinner className="mt-2" label={sheet ? undefined : 'Rédaction de la fiche…'} />}
              {current?.error && <ErrorBox error={current.error} onRetry={() => write(notion.id, false)} />}
            </section>

            {(prerequisites.length > 0 || usedBy.length > 0 || children.length > 0) && (
              <section className="space-y-4">
                <ChipRow label="Prérequis" items={prerequisites} onSelect={onSelect} />
                <ChipRow label="Sous-notions" items={children} onSelect={onSelect} />
                <ChipRow label="Utilisée par" items={usedBy} onSelect={onSelect} />
              </section>
            )}

            {detail.data && detail.data.id === notion.id && detail.data.sections.length > 0 && (
              <section>
                <SectionLabel>Dans le cours</SectionLabel>
                <div className="-mx-2 space-y-1">
                  {detail.data.sections.map((s) => (
                    <Toggle
                      key={s.id}
                      summary={
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate">{s.title}</span>
                          <span className="shrink-0 text-xs text-ink-3">
                            {s.unitTitle} · p. {s.pageStart}–{s.pageEnd}
                          </span>
                        </span>
                      }
                    >
                      <Markdown className="pb-4 text-sm">{s.contentMd || '*Section vide.*'}</Markdown>
                    </Toggle>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function ChipRow({ label, items, onSelect }: { label: string; items: NotionDto[]; onSelect: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((n) => (
          <button key={n.id} type="button" onClick={() => onSelect(n.id)} className="rounded bg-block px-2 text-sm leading-6 transition-colors hover:bg-hover">
            {n.title}
          </button>
        ))}
      </div>
    </div>
  );
}
