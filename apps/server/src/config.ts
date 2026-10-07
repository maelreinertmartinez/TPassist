// Configuration lue une fois au démarrage (variables d'environnement, chemins des données).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const dataDir = resolve(process.env.DATA_DIR ?? join(repoRoot, 'data'));

/** Configuration de l’application. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  dbFile: join(dataDir, 'tpassist.db'),
  filesDir: join(dataDir, 'files'),
  pagesDir: join(dataDir, 'pages'),
  /** Photos de copies et images jointes au chat. */
  answersDir: join(dataDir, 'answers'),
  /** Répertoire de travail (cwd) des agents : stable pour permettre la reprise des sessions SDK. */
  workspaceDir: join(dataDir, 'workspace'),
  webDist: resolve(process.env.WEB_DIST ?? join(repoRoot, 'apps/web/dist')),
  migrationsDir: fileURLToPath(new URL('../drizzle', import.meta.url)),

  model: process.env.TPASSIST_MODEL || 'claude-opus-5-5',
  modelIngest: process.env.TPASSIST_MODEL_INGEST || undefined,
  modelTutor: process.env.TPASSIST_MODEL_TUTOR || undefined,
  aiMock: process.env.TPASSIST_AI_MOCK === '1',
  aiConcurrency: Math.max(1, Number(process.env.TPASSIST_AI_CONCURRENCY ?? 3)),
  /** Délai de déblocage des aides, en temps actif sur la question. */
  unlockDelayMs: Math.max(0, Number(process.env.TPASSIST_UNLOCK_DELAY_SEC ?? 120)) * 1000,
  /** Plafond d'un signal de présence (évite de compter une absence). */
  heartbeatCapMs: 15_000,
};

/** Crée les dossiers de données s'ils n'existent pas. */
export function ensureDataDirs() {
  for (const dir of [config.dataDir, config.filesDir, config.pagesDir, config.answersDir, config.workspaceDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Famille de tâche IA : chacune peut utiliser un modèle différent (variables TPASSIST_MODEL_*). */
export type TaskKind = 'ingest' | 'tutor' | 'generate';

/** Modèle à utiliser pour une famille de tâches (le modèle principal par défaut). */
export function modelFor(kind: TaskKind): string {
  if (kind === 'ingest') return config.modelIngest ?? config.model;
  if (kind === 'tutor') return config.modelTutor ?? config.model;
  return config.model;
}
