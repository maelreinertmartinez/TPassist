// Heuristiques utilisées uniquement en mode simulation (TPASSIST_AI_MOCK=1) pour
// produire une structure plausible à partir de la couche texte du PDF.
import type { CorrigeExtraction, CourseExtraction, ExerciseExtraction } from '../ai/schemas';
import type { PageClass, PageKind } from './segment';

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 2)
      ?.slice(0, 80) ?? ''
  );
}

export function classifyPageText(text: string): PageKind {
  const t = text.toLowerCase();
  const head = t.slice(0, 300);
  if (!t.trim()) return 'autre';
  if (/corrig|correction\b|solutions? d/.test(head)) return 'corrige';
  if (/\bei\b|examen|évaluation|evaluation|partiel|devoir surveill/.test(head)) return 'ei';
  if (/\btp\b|travaux pratiques/.test(head)) return 'tp';
  if (/\btd\b|travaux dirig|feuille d'exercices/.test(head)) return 'td';
  if (/^\s*exercice/m.test(head)) return 'td';
  return 'cours';
}

export function mockSegmentation(pages: { page: number; text: string }[], prev: PageClass | null): PageClass[] {
  const out: PageClass[] = [];
  let last = prev;
  for (const p of pages) {
    let kind = classifyPageText(p.text);
    const head = p.text.toLowerCase().slice(0, 300);
    const explicitStart = /chapitre|^\s*(td|tp|ei|examen|corrig)/m.test(head);
    if (kind === 'td' && last && last.kind !== 'td' && !explicitStart && /^\s*exercice/m.test(head) && last.kind !== 'cours') kind = last.kind;
    const startsNewUnit = !last || last.kind !== kind || explicitStart;
    const cls: PageClass = {
      page: p.page,
      kind,
      unitTitle: startsNewUnit ? firstLine(p.text) : (last?.unitTitle ?? firstLine(p.text)),
      startsNewUnit,
      startsMidPage: false,
    };
    out.push(cls);
    last = cls;
  }
  return out;
}

const QUESTION_RE = /^\s*(?:Question\s*)?(\d+(?:\.\d+)?(?:\.?[a-z])?|[a-z])\s*[.)]\s+(.+)$/i;
const EXERCISE_RE = /^\s*Exercice\s*(\d+)\s*[:.–-]?\s*(.*)$/i;

export function mockExtractExercises(pages: { page: number; text: string }[], kind: string): ExerciseExtraction {
  const exercises: ExerciseExtraction['exercises'] = [];
  let cur: ExerciseExtraction['exercises'][number] | null = null;
  let q: ExerciseExtraction['exercises'][number]['questions'][number] | null = null;
  let inSolution = false;
  for (const { page, text } of pages) {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const ex = EXERCISE_RE.exec(line);
      if (ex) {
        cur = { title: `Exercice ${ex[1]}${ex[2] ? ` – ${ex[2]}` : ''}`, continuesPrevious: false, contextMd: '', questions: [] };
        exercises.push(cur);
        q = null;
        inSolution = false;
        continue;
      }
      if (!cur) continue;
      if (/^correction\s*:/i.test(line) && q) {
        inSolution = true;
        q.inlineSolutionMd = line.replace(/^correction\s*:\s*/i, '');
        continue;
      }
      const qm = QUESTION_RE.exec(line);
      if (qm) {
        q = { label: qm[1], statementMd: qm[2], figurePages: [], dependsOnPrevious: false, points: null, inlineSolutionMd: null };
        cur.questions.push(q);
        inSolution = false;
        continue;
      }
      if (q && inSolution) q.inlineSolutionMd = `${q.inlineSolutionMd ?? ''}\n${line}`;
      else if (q) q.statementMd += `\n${line}`;
      else cur.contextMd = `${cur.contextMd}\n${line}`.trim();
      void page;
    }
  }
  if (exercises.length === 0) {
    exercises.push({
      title: 'Exercice 1',
      continuesPrevious: false,
      contextMd: '',
      questions: pages.slice(0, 3).map((p, i) => ({
        label: String(i + 1),
        statementMd: p.text.slice(0, 400) || `Question ${i + 1}`,
        figurePages: [],
        dependsOnPrevious: false,
        points: null,
        inlineSolutionMd: null,
      })),
    });
  }
  return { durationMinutes: kind === 'ei' ? 120 : null, exercises };
}

export function mockExtractCours(pages: { page: number; text: string }[]): CourseExtraction {
  return {
    sections: pages.map((p) => ({
      title: firstLine(p.text) || `Page ${p.page}`,
      pageStart: p.page,
      pageEnd: p.page,
      summary: p.text.slice(0, 200).replace(/\s+/g, ' '),
      keyConcepts: [],
      contentMd: p.text,
      continuesPrevious: false,
    })),
  };
}

export function mockExtractCorrige(pages: { page: number; text: string }[]): CorrigeExtraction {
  const solutions: CorrigeExtraction['solutions'] = [];
  let exLabel = 'Exercice 1';
  let cur: CorrigeExtraction['solutions'][number] | null = null;
  for (const { page, text } of pages) {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const ex = EXERCISE_RE.exec(line);
      if (ex) {
        exLabel = `Exercice ${ex[1]}`;
        cur = null;
        continue;
      }
      const qm = QUESTION_RE.exec(line);
      if (qm) {
        cur = { exerciseLabel: exLabel, questionLabel: qm[1], solutionMd: qm[2], pageStart: page, pageEnd: page };
        solutions.push(cur);
        continue;
      }
      if (cur) {
        cur.solutionMd += `\n${line}`;
        cur.pageEnd = page;
      }
    }
  }
  return { targetTitle: firstLine(pages[0]?.text ?? '').replace(/corrig[ée]+\s*(du|de la)?\s*/i, ''), solutions };
}
