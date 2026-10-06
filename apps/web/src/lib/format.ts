export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

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

/** Réduit une image (photo de copie) et renvoie une data URL JPEG. */
export async function imageFileToDataUrl(file: Blob, maxSide = 2000, quality = 0.85): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function pluralize(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}
