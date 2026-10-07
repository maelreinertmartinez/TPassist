// Onglet « Cours » : les chapitres, leurs sections et notions clés ; modification et suppression d'un chapitre.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CourseDetail, UnitDto } from '@tpassist/shared';
import clsx from 'clsx';
import { Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorBox, IconButton, Tag, Toggle, useConfirm } from '../../components/ui';
import { api } from '../../lib/api';
import { plural } from '../../lib/format';

/** @param onChange appelé après la suppression d'un chapitre (pour recharger la page du cours) */
export function CoursList({ units, detail, onChange }: { units: UnitDto[]; detail: CourseDetail; onChange: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/units/${id}`),
    onSuccess: () => {
      onChange();
      // La carte des notions perd les notions de ce chapitre (et signale qu'elle est à mettre à jour).
      void qc.invalidateQueries({ queryKey: ['notions', detail.course.id] });
    },
  });
  const ask = async (u: UnitDto, sectionCount: number) => {
    const ok = await confirm({
      title: `Supprimer « ${u.title} » ?`,
      message: `${sectionCount === 0 ? 'Ce chapitre et ses notions seront supprimés.' : sectionCount === 1 ? 'Sa section et ses notions seront supprimées.' : `Ses ${sectionCount} sections et ses notions seront supprimées.`} Le PDF d’origine reste dans Documents : le réanalyser recréerait le chapitre.`,
      confirmLabel: 'Supprimer le chapitre',
      danger: true,
    });
    if (ok) remove.mutate(u.id);
  };
  return (
    <div className="space-y-2">
      <ErrorBox error={remove.error} />
      {units.map((u) => {
        const sections = detail.sections.filter((s) => s.unitId === u.id);
        const deleting = remove.isPending && remove.variables === u.id;
        return (
          <Toggle
            key={u.id}
            className={clsx(deleting && 'pointer-events-none opacity-50')}
            summary={
              <span className="group/row flex items-center justify-between gap-2">
                <span className="truncate">{u.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-3">
                    {plural(sections.length, 'section')}
                  </span>
                  {/* Dans le résumé du bloc dépliable : le clic ne doit pas le déplier. */}
                  <IconButton
                    label={`Supprimer « ${u.title} »`}
                    className="-my-1 transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void ask(u, sections.length);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </span>
              </span>
            }
          >
            <div className="space-y-4 pb-4">
              {sections.map((s) => (
                <div key={s.id}>
                  <p className="text-sm font-semibold">
                    {s.title} <span className="font-normal text-ink-3">· p. {s.pageStart}–{s.pageEnd}</span>
                  </p>
                  {s.summary && <p className="mt-1 max-w-[65ch] text-sm text-ink-2">{s.summary}</p>}
                  {s.keyConcepts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.keyConcepts.slice(0, 8).map((k) => (
                        <Tag key={k}>{k}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="tertiary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/units/${u.id}/edit`)}>
                  Modifier ce chapitre
                </Button>
                <Button size="sm" variant="danger-quiet" icon={<Trash2 className="size-4" />} loading={deleting} onClick={() => ask(u, sections.length)}>
                  Supprimer ce chapitre
                </Button>
              </div>
            </div>
          </Toggle>
        );
      })}
    </div>
  );
}
