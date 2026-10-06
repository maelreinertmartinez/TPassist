// Génère samples/exemple-algebre.pdf : un PDF d'exemple qui mélange cours, TD, corrigé et EI.
// Usage : node scripts/make-sample-pdf.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pages = [
  [
    'Chapitre 1 - Matrices',
    '',
    'Definition 1. Une matrice de taille n x p est un tableau de nombres a n lignes et p colonnes.',
    'Le produit AB de A (n x p) par B (p x q) est la matrice C (n x q) avec',
    'c_ij = somme pour k de 1 a p de a_ik b_kj.',
    '',
    'Propriete. Le produit matriciel est associatif mais n\'est pas commutatif en general.',
    'Exemple : la matrice identite I_n verifie A I_n = I_n A = A.',
  ],
  [
    'Chapitre 2 - Determinant',
    '',
    'Definition 2. Pour une matrice 2 x 2, det(A) = ad - bc.',
    'Theoreme. A est inversible si et seulement si det(A) est non nul.',
    'Methode : pour calculer l\'inverse d\'une matrice 2 x 2, on utilise',
    'A^-1 = (1 / det A) * [[d, -b], [-c, a]].',
  ],
  [
    'TD 1 - Calcul matriciel',
    '',
    'Exercice 1 - Produit de matrices',
    'On considere A = [[1, 2], [3, 4]] et B = [[0, 1], [1, 0]].',
    '1) Calculer le produit AB.',
    '2) Calculer le produit BA. Le produit est-il commutatif ?',
    '',
    'Exercice 2 - Inverse',
    'Soit M = [[2, 1], [1, 1]].',
    '1) Calculer det(M).',
    '2) En deduire que M est inversible et calculer M^-1.',
  ],
  [
    'Corrige du TD 1 - Calcul matriciel',
    '',
    'Exercice 1',
    '1) AB = [[2, 1], [4, 3]].',
    '2) BA = [[3, 4], [1, 2]] donc AB est different de BA : le produit n\'est pas commutatif.',
    'Exercice 2',
    '1) det(M) = 2*1 - 1*1 = 1.',
    '2) det(M) est non nul donc M est inversible et M^-1 = [[1, -1], [-1, 2]].',
  ],
  [
    'EI 2025 - Algebre lineaire (duree 1h30)',
    '',
    'Exercice 1 (10 points)',
    'Soit C = [[1, 1], [0, 1]].',
    '1) Calculer C^2 puis C^3. (5 points)',
    '2) Conjecturer C^n et le demontrer par recurrence. (5 points)',
    '',
    'Exercice 2 (10 points)',
    '1) Donner une matrice 2 x 2 non nulle et non inversible. (4 points)',
    '2) Calculer l\'inverse de D = [[3, 2], [1, 1]]. (6 points)',
  ],
];

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const objects = [];
const add = (body) => {
  objects.push(body);
  return objects.length;
};

const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
const pagesId = objects.length + 1 + pages.length * 2; // réservé après les pages
const pageIds = [];
for (const lines of pages) {
  let y = 780;
  const ops = ['BT'];
  lines.forEach((line, i) => {
    ops.push(`/${i === 0 ? 'F2' : 'F1'} ${i === 0 ? 16 : 11} Tf`);
    ops.push(`1 0 0 1 56 ${y} Tm (${esc(line)}) Tj`);
    y -= i === 0 ? 28 : 18;
  });
  ops.push('ET');
  const stream = ops.join('\n');
  const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  pageIds.push(
    add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ),
  );
}
const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
if (realPagesId !== pagesId) throw new Error('numérotation des objets incohérente');
const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out, 'latin1'));
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(out, 'latin1');
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const file = join(root, 'samples', 'exemple-algebre.pdf');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, Buffer.from(out, 'latin1'));
console.log(`PDF d'exemple écrit : ${file}`);
