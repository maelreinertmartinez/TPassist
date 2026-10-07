// Apparence d'un cours : pastille d'icône, choix de l'icône et choix de la couleur.
import { COURSE_COLORS } from '@tpassist/shared';
import clsx from 'clsx';
import { COURSE_ICONS, courseIcon } from '../lib/courseIcons';

/** Pastille d'icône du cours : icône blanche (au trait) sur la couleur du cours. */
export function CourseIconTile({ icon, color, size = 'md', className }: { icon: string; color: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { Icon, label } = courseIcon(icon);
  return (
    <span
      className={clsx(
        'grid shrink-0 place-items-center text-white',
        size === 'sm' && 'size-8 rounded',
        size === 'md' && 'size-12 rounded-lg',
        size === 'lg' && 'size-16 rounded-lg shadow-e1',
        className,
      )}
      style={{ background: color }}
      title={label}
    >
      <Icon className={size === 'sm' ? 'size-4' : size === 'md' ? 'size-6' : 'size-8'} />
    </span>
  );
}

/** Grille de choix d'icône, dessinée sur la couleur du cours. */
export function IconPicker({ value, onChange, color }: { value: string; onChange: (key: string) => void; color: string }) {
  const current = courseIcon(value);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">
        Icône <span className="font-normal text-ink-3">· {current.label}</span>
      </legend>
      <div className="grid grid-cols-8 gap-1" role="radiogroup">
        {COURSE_ICONS.map(({ key, label, Icon }) => {
          const selected = key === current.key;
          return (
            <button
              type="button"
              key={key}
              role="radio"
              aria-checked={selected}
              aria-label={label}
              title={label}
              onClick={() => onChange(key)}
              className={clsx(
                'grid aspect-square place-items-center rounded transition-colors',
                selected ? 'text-white shadow-e1' : 'text-ink-3 hover:bg-hover hover:text-ink',
              )}
              style={selected ? { background: color } : undefined}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Choix de la couleur d'un cours parmi la palette. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Couleur</legend>
      <div className="flex flex-wrap gap-2">
        {COURSE_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => onChange(c)}
            aria-label={`Couleur ${c}`}
            aria-pressed={value === c}
            className="size-8 rounded-full ring-offset-2 ring-offset-page transition-shadow aria-pressed:ring-2 aria-pressed:ring-ink"
            style={{ background: c }}
          />
        ))}
      </div>
    </fieldset>
  );
}
