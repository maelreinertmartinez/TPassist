// Sauvegarde du volume de données de TPassist (base SQLite, PDF, pages, photos, conversations).
// Usage : npm run backup  →  ./backups/tpassist-AAAAMMJJ-HHMM/
// L'application est arrêtée quelques secondes pendant la copie pour garantir une base cohérente.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const target = join(root, 'backups', `tpassist-${stamp}`);
mkdirSync(join(root, 'backups'), { recursive: true });

const compose = (...args) => execFileSync('docker', ['compose', ...args], { cwd: root, stdio: 'inherit' });

console.log('Arrêt temporaire de TPassist…');
compose('stop', 'tpassist');
try {
  console.log(`Copie des données vers ${target}…`);
  compose('cp', 'tpassist:/data', target);
} finally {
  console.log('Redémarrage de TPassist…');
  compose('start', 'tpassist');
}
console.log('Sauvegarde terminée.');
