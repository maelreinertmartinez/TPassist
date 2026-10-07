// Images choisies ou collées par l'étudiant (photo de copie, image jointe au chat).
import type { ClipboardEvent } from 'react';

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

/** Première image collée (Ctrl+V), s'il y en a une. */
export function imageFromClipboard(e: ClipboardEvent): File | undefined {
  return [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
}
