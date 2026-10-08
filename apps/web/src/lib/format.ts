// Mise en forme des nombres, durées et dates pour l'affichage (en français).

/** Compte à rebours « m:ss » (arrondi à la seconde supérieure). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Chronomètre « h:mm:ss » (ou « m:ss » sous une heure). */
export function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Date et heure : « 6 oct. 2026, 22:10 ». */
export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

/** Durée en minutes : « 12 min », « < 1 min ». */
export function formatMinutes(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 1 ? '< 1 min' : `${m} min`;
}

const usd2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('fr-FR');

/** Coût en dollars : « 4,64 $ », « < 0,01 $ » pour un montant non nul minuscule. */
export function formatUsd(n: number): string {
  if (n > 0 && n < 0.005) return '< 0,01 $';
  return `${usd2.format(n)} $`;
}

/** Grand nombre compact : 1 284 → « 1,3 k », 2 400 000 → « 2,4 M ». */
export function formatCompact(n: number): string {
  return n < 1000 ? integer.format(n) : compact.format(n);
}

/** Entier avec séparateur de milliers : « 12 345 ». */
export function formatInt(n: number): string {
  return integer.format(n);
}

/** Durée lisible d'un appel : « 850 ms », « 12 s », « 1 min 05 s ». */
export function formatSpan(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** Clé de jour local AAAA-MM-JJ. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Mot accordé au nombre : « question » ou « questions » (pluriel régulier par défaut). */
export function pluralWord(n: number, one: string, many = `${one}s`): string {
  return n > 1 ? many : one;
}

/** « 1 question », « 3 questions » : le nombre suivi du mot accordé. */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${pluralWord(n, one, many)}`;
}

/** Plage de pages : « p. 3 » ou « p. 3–5 ». */
export function formatPageRange(start: number | null, end: number | null): string {
  if (start === null) return '';
  return end === null || end === start ? `p. ${start}` : `p. ${start}–${end}`;
}
