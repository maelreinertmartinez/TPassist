// Lecture des PDF avec poppler (pdfinfo, pdftotext, pdftoppm) : nombre de pages, texte et rendu des pages en PNG.
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';

const exec = promisify(execFile);

/** Outil poppler absent ou en échec. */
class PdfToolError extends Error {}

async function run(cmd: string, args: string[]) {
  try {
    return await exec(cmd, args, { maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new PdfToolError(`${cmd} est introuvable : installe poppler-utils (fourni dans l'image Docker).`);
    }
    throw new PdfToolError(`${cmd} a échoué : ${e.stderr || e.message}`);
  }
}

/** Nombre de pages d'un PDF. */
export async function pdfPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await run('pdfinfo', [pdfPath]);
  const m = /Pages:\s+(\d+)/.exec(stdout);
  if (!m) throw new PdfToolError('Nombre de pages illisible (PDF corrompu ?)');
  return Number(m[1]);
}

/** Texte de chaque page (index 0 = page 1). */
export async function pdfPagesText(pdfPath: string): Promise<string[]> {
  const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-']);
  const pages = stdout.split('\f');
  if (pages.length > 0 && pages[pages.length - 1].trim() === '') pages.pop();
  return pages.map((p) => p.replace(/[ \t]+$/gm, '').trim());
}

/** Chemin du rendu PNG d'une page (`full` : 1600 px, `thumb` : 900 px). */
export function pageImagePath(documentId: string, page: number, variant: 'full' | 'thumb' = 'full') {
  return join(config.pagesDir, documentId, `${variant === 'full' ? 'p' : 't'}-${page}.png`);
}

/** URL publique du rendu pleine résolution d'une page. */
export function pageImageUrl(documentId: string, page: number) {
  return `/api/documents/${documentId}/pages/${page}.png`;
}

/** Rend chaque page en PNG (pleine résolution et miniature). */
export async function renderPages(pdfPath: string, documentId: string): Promise<void> {
  const dir = join(config.pagesDir, documentId);
  await mkdir(dir, { recursive: true });
  for (const [variant, size] of [
    ['p', 1600],
    ['t', 900],
  ] as const) {
    const prefix = join(dir, `raw-${variant}`);
    await run('pdftoppm', ['-png', '-scale-to', String(size), pdfPath, prefix]);
    // pdftoppm nomme raw-p-01.png, raw-p-001.png… selon le nombre de pages.
    const files = (await readdir(dir)).filter((f) => f.startsWith(`raw-${variant}-`) && f.endsWith('.png'));
    for (const f of files) {
      const n = Number(f.slice(`raw-${variant}-`.length, -4));
      if (Number.isFinite(n)) await rename(join(dir, f), join(dir, `${variant}-${n}.png`));
    }
  }
}

/** Rendu d'une page en base64, pour l'envoyer à l'IA. */
export async function readPageBase64(documentId: string, page: number, variant: 'full' | 'thumb'): Promise<string> {
  const buf = await readFile(pageImagePath(documentId, page, variant));
  return buf.toString('base64');
}
