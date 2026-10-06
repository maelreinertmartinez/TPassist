import clsx from 'clsx';
import {
  Atom,
  Binary,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Calculator,
  ChartLine,
  CircuitBoard,
  Code,
  Cog,
  Coins,
  Cpu,
  Database,
  Dna,
  DraftingCompass,
  Earth,
  Factory,
  Feather,
  FlaskConical,
  Gavel,
  GraduationCap,
  HeartPulse,
  Infinity as InfinityIcon,
  Landmark,
  Languages,
  Leaf,
  Library,
  Lightbulb,
  Magnet,
  Microscope,
  Music,
  Network,
  Orbit,
  Palette,
  Pi,
  Radical,
  Rocket,
  Scale,
  Shapes,
  Sigma,
  Stethoscope,
  Telescope,
  Terminal,
  Thermometer,
  Variable,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Jeu d'icônes proposé pour les cours (clé stockée en base → icône + libellé). */
export const COURSE_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'graduation-cap', label: 'Général', Icon: GraduationCap },
  { key: 'sigma', label: 'Mathématiques', Icon: Sigma },
  { key: 'pi', label: 'Pi', Icon: Pi },
  { key: 'radical', label: 'Analyse', Icon: Radical },
  { key: 'variable', label: 'Algèbre', Icon: Variable },
  { key: 'infinity', label: 'Infini', Icon: InfinityIcon },
  { key: 'calculator', label: 'Calcul', Icon: Calculator },
  { key: 'chart-line', label: 'Statistiques', Icon: ChartLine },
  { key: 'shapes', label: 'Géométrie', Icon: Shapes },
  { key: 'drafting-compass', label: 'Dessin technique', Icon: DraftingCompass },
  { key: 'atom', label: 'Physique', Icon: Atom },
  { key: 'zap', label: 'Électricité', Icon: Zap },
  { key: 'magnet', label: 'Magnétisme', Icon: Magnet },
  { key: 'thermometer', label: 'Thermodynamique', Icon: Thermometer },
  { key: 'orbit', label: 'Mécanique', Icon: Orbit },
  { key: 'telescope', label: 'Astronomie', Icon: Telescope },
  { key: 'rocket', label: 'Aérospatial', Icon: Rocket },
  { key: 'flask-conical', label: 'Chimie', Icon: FlaskConical },
  { key: 'dna', label: 'Biologie', Icon: Dna },
  { key: 'microscope', label: 'Sciences du vivant', Icon: Microscope },
  { key: 'leaf', label: 'Environnement', Icon: Leaf },
  { key: 'heart-pulse', label: 'Médecine', Icon: HeartPulse },
  { key: 'stethoscope', label: 'Santé', Icon: Stethoscope },
  { key: 'brain', label: 'Psychologie', Icon: Brain },
  { key: 'code', label: 'Programmation', Icon: Code },
  { key: 'terminal', label: 'Systèmes', Icon: Terminal },
  { key: 'cpu', label: 'Architecture', Icon: Cpu },
  { key: 'circuit-board', label: 'Électronique', Icon: CircuitBoard },
  { key: 'database', label: 'Bases de données', Icon: Database },
  { key: 'network', label: 'Réseaux', Icon: Network },
  { key: 'binary', label: 'Algorithmique', Icon: Binary },
  { key: 'bot', label: 'Intelligence artificielle', Icon: Bot },
  { key: 'cog', label: 'Ingénierie', Icon: Cog },
  { key: 'wrench', label: 'Mécanique appliquée', Icon: Wrench },
  { key: 'factory', label: 'Industrie', Icon: Factory },
  { key: 'earth', label: 'Géographie', Icon: Earth },
  { key: 'landmark', label: 'Histoire', Icon: Landmark },
  { key: 'scale', label: 'Droit', Icon: Scale },
  { key: 'gavel', label: 'Justice', Icon: Gavel },
  { key: 'briefcase', label: 'Gestion', Icon: Briefcase },
  { key: 'coins', label: 'Économie', Icon: Coins },
  { key: 'languages', label: 'Langues', Icon: Languages },
  { key: 'feather', label: 'Lettres', Icon: Feather },
  { key: 'library', label: 'Bibliothèque', Icon: Library },
  { key: 'book-open', label: 'Lecture', Icon: BookOpen },
  { key: 'palette', label: 'Arts', Icon: Palette },
  { key: 'music', label: 'Musique', Icon: Music },
  { key: 'lightbulb', label: 'Idées', Icon: Lightbulb },
];

const BY_KEY = new Map(COURSE_ICONS.map((i) => [i.key, i]));

export function courseIcon(key: string | undefined) {
  return BY_KEY.get(key ?? '') ?? COURSE_ICONS[0];
}

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
