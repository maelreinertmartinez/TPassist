// Garde-fou du système de design (« Refactoring UI » : limiter les choix, tout systématiser).
// Vérifie que le front n'utilise que les valeurs définies d'avance :
// - espacements et tailles : 4, 8, 12, 16, 24, 32, 48, 64, 96, 128… px ;
// - tailles de texte : 12 → 30 px (text-xs → text-3xl) ;
// - graisses : 400 et 600 uniquement ;
// - rayons : rounded (4 px), rounded-lg (8 px), rounded-full ;
// - pas de valeurs arbitraires (sauf exceptions listées) ni de couleurs hexadécimales dans les TSX.
// Usage : node scripts/check-design.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'apps/web/src');

const SCALE = new Set(['0', 'px', '1', '2', '3', '4', '6', '8', '12', '16', '24', '32', '48', '64', '96', '128']);
const SPACING_PREFIXES = [
  'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'ps', 'pe',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'ms', 'me',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y',
  'inset', 'inset-x', 'inset-y', 'top', 'bottom', 'left', 'right',
  'w', 'h', 'size', 'min-w', 'min-h', 'max-h', 'max-w', 'translate-x', 'translate-y', 'scroll-mt',
];
/** Valeurs arbitraires tolérées, chacune justifiée. */
const ALLOWED_ARBITRARY = [
  'max-w-[65ch]', // longueur de ligne 45–75 caractères
  'lg:h-[calc(100dvh-8rem)]', // panneau de réponse collant : écran − barre du haut (48) − progression (64) − marge (16)
];

/** Positions dérivées de la mise en page (somme de hauteurs du système), pas des choix d'espacement. */
const STRUCTURAL = new Set([
  'top-28', // 48 (barre du haut) + 64 (barre de progression collante)
]);

const RULES = [
  { re: /\bfont-(thin|extralight|light|medium|bold|extrabold|black)\b/g, msg: 'graisse hors système (400/600 uniquement)' },
  { re: /\btext-(4xl|5xl|6xl|7xl|8xl|9xl)\b/g, msg: 'taille de texte hors échelle (max text-3xl)' },
  { re: /\brounded-(xs|sm|md|xl|2xl|3xl|4xl)\b/g, msg: 'rayon hors système (rounded, rounded-lg, rounded-full)' },
  { re: /#[0-9a-fA-F]{3,8}\b/g, msg: 'couleur hexadécimale (utiliser les jetons du thème)' },
  { re: /\b(?:[a-z0-9:-]*:)?[a-z-]+-\[[^\]\s]+\]/g, msg: 'valeur arbitraire', allow: (m) => ALLOWED_ARBITRARY.some((a) => m.endsWith(a)) },
];

const spacingRe = new RegExp(`(?<![\\w-])-?(${SPACING_PREFIXES.join('|')})-(\\d+(?:\\.\\d+)?|px)(?![\\w.%/-])`, 'g');

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx|ts)$/.test(name)) yield p;
  }
}

const problems = [];
for (const file of files(srcDir)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // On ignore les commentaires et les imports.
    if (/^\s*(\/\/|\*|import )/.test(line)) return;
    const where = `${relative(root, file)}:${i + 1}`;
    for (const r of RULES) {
      if (r.re.source.startsWith('#') && !file.endsWith('.tsx')) continue;
      for (const m of line.matchAll(r.re)) {
        if (r.allow?.(m[0])) continue;
        problems.push(`${where}  ${m[0]}  → ${r.msg}`);
      }
    }
    for (const m of line.matchAll(spacingRe)) {
      if (!SCALE.has(m[2]) && !STRUCTURAL.has(m[0].replace(/^-/, ''))) problems.push(`${where}  ${m[0]}  → espacement/taille hors échelle (4, 8, 12, 16, 24, 32, 48, 64, 96 px…)`);
    }
  });
}

if (problems.length) {
  console.error(`Système de design : ${problems.length} écart(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Système de design : aucun écart.');
