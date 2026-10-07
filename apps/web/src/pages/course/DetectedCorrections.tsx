// Corrigés détectés dans les PDF d'un cours (sous la liste des TD & TP) : sujet rattaché et solutions associées.
import type { UnitDto } from '@tpassist/shared';
import { useNavigate } from 'react-router-dom';
import { Button, Toggle } from '../../components/ui';
import { KIND_ICON, Row } from './common';

/**
 * @param corriges les corrigés du cours
 * @param units toutes les parties du cours, pour retrouver le sujet de chaque corrigé
 */
export function DetectedCorrections({ corriges, units }: { corriges: UnitDto[]; units: UnitDto[] }) {
  const navigate = useNavigate();
  if (corriges.length === 0) return null;
  return (
    <Toggle className="mt-6" summary={<span className="text-ink-3">Corrigés détectés ({corriges.length})</span>}>
      <ul className="space-y-1">
        {corriges.map((c) => {
          const target = units.find((u) => u.id === c.correctsUnitId);
          const matched = c.meta.solutions?.filter((s) => s.matchedQuestionId).length ?? 0;
          return (
            <Row
              key={c.id}
              icon={KIND_ICON.corrige}
              title={c.title}
              meta={target ? `Rattaché à « ${target.title} » · ${matched}/${c.meta.solutions?.length ?? 0} solutions associées` : 'Non rattaché'}
              actions={
                <Button size="sm" variant="tertiary" onClick={() => navigate(`/units/${c.id}/edit`)}>
                  Gérer
                </Button>
              }
            />
          );
        })}
      </ul>
    </Toggle>
  );
}
