// Schéma de la base SQLite (Drizzle). Les migrations sont générées par `npm run db:generate`.
// Les champs JSON sont typés avec les types partagés (@tpassist/shared).
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  AnswerType,
  DocumentStatus,
  EventKind,
  HelpKind,
  JobStatus,
  JobType,
  NotionKind,
  QuestionFlags,
  QuestionStatus,
  QuizItemType,
  QuizKind,
  QuizStatus,
  ReportStatus,
  SessionMode,
  SessionStatus,
  SolutionSource,
  UnitKind,
  UnitMeta,
  UnitOrigin,
  Verdict,
  WeakPointStatus,
  CourseRef,
  ReportDto,
} from '@tpassist/shared';

const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
const id = () => text('id').primaryKey();
const createdAt = () => integer('created_at').notNull().default(now);
const updatedAt = () => integer('updated_at').notNull().default(now);

/** Cours (module) : regroupe les documents, les parties et le suivi de l’étudiant. */
export const courses = sqliteTable('courses', {
  id: id(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#4f46e5'),
  /** Clé d'icône (jeu d'icônes défini côté front). */
  icon: text('icon').notNull().default('graduation-cap'),
  /** Empreinte des sections de cours lors de la dernière génération de la carte des notions. */
  notionsSignature: text('notions_signature'),
  notionsGeneratedAt: integer('notions_generated_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** PDF importés, avec le texte de chaque page. */
export const documents = sqliteTable(
  'documents',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    path: text('path').notNull(),
    pageCount: integer('page_count'),
    status: text('status').$type<DocumentStatus>().notNull().default('pending'),
    error: text('error'),
    /** Texte extrait page par page (couche texte du PDF). */
    pagesText: text('pages_text', { mode: 'json' }).$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [index('documents_course_idx').on(t.courseId)],
);

/** Parties détectées dans les PDF (chapitre, TD, TP, EI, corrigé) ou EI générées. */
export const units = sqliteTable(
  'units',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<UnitKind>().notNull(),
    title: text('title').notNull(),
    order: integer('order').notNull().default(0),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    origin: text('origin').$type<UnitOrigin>().notNull().default('imported'),
    correctsUnitId: text('corrects_unit_id'),
    meta: text('meta', { mode: 'json' }).$type<UnitMeta>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('units_course_idx').on(t.courseId), index('units_document_idx').on(t.documentId)],
);

/** Sections des chapitres de cours (contenu transcrit en Markdown). */
export const courseSections = sqliteTable(
  'course_sections',
  {
    id: id(),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
    title: text('title').notNull(),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    summary: text('summary').notNull().default(''),
    keyConcepts: text('key_concepts', { mode: 'json' }).$type<string[]>().notNull().default([]),
    contentMd: text('content_md').notNull().default(''),
  },
  (t) => [index('sections_unit_idx').on(t.unitId), index('sections_course_idx').on(t.courseId)],
);

/** Carte des notions d’un cours. */
export const notions = sqliteTable(
  'notions',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    order: integer('order').notNull().default(0),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    kind: text('kind').$type<NotionKind>().notNull().default('concept'),
    sectionIds: text('section_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    prerequisiteIds: text('prerequisite_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Fiche détaillée rédigée par l'IA (générée au premier clic). */
    detailMd: text('detail_md'),
    createdAt: createdAt(),
  },
  (t) => [index('notions_course_idx').on(t.courseId)],
);

/** Exercices d’un TD, TP ou EI. */
export const exercises = sqliteTable(
  'exercises',
  {
    id: id(),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
    title: text('title').notNull(),
    contextMd: text('context_md').notNull().default(''),
  },
  (t) => [index('exercises_unit_idx').on(t.unitId)],
);

/** Questions d’un exercice, avec le corrigé officiel s’il existe. */
export const questions = sqliteTable(
  'questions',
  {
    id: id(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    /** Document dont proviennent les pages de figures. */
    documentId: text('document_id'),
    order: integer('order').notNull().default(0),
    label: text('label').notNull(),
    statementMd: text('statement_md').notNull(),
    figurePages: text('figure_pages', { mode: 'json' }).$type<number[]>().notNull().default([]),
    dependsOnPrevious: integer('depends_on_previous', { mode: 'boolean' }).notNull().default(false),
    points: real('points'),
    officialSolutionMd: text('official_solution_md'),
    officialSolutionDocId: text('official_solution_doc_id'),
    officialSolutionPages: text('official_solution_pages', { mode: 'json' }).$type<number[]>(),
    weakPointId: text('weak_point_id'),
  },
  (t) => [index('questions_unit_idx').on(t.unitId), index('questions_exercise_idx').on(t.exerciseId)],
);

/** Aides générées par l’IA pour une question, réutilisées par toutes les séances. */
export const questionAiCache = sqliteTable(
  'question_ai_cache',
  {
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<HelpKind>().notNull(),
    contentMd: text('content_md').notNull().default(''),
    data: text('data', { mode: 'json' }).$type<{ courseRefs?: CourseRef[]; source?: SolutionSource }>(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.kind] })],
);

/** Séances de TD, TP ou EI. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<SessionMode>().notNull(),
    status: text('status').$type<SessionStatus>().notNull().default('in_progress'),
    currentQuestionId: text('current_question_id'),
    timeLimitSec: integer('time_limit_sec'),
    elapsedSec: real('elapsed_sec').notNull().default(0),
    lastTickAt: integer('last_tick_at'),
    score: real('score'),
    reviewQuizId: text('review_quiz_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('sessions_course_idx').on(t.courseId)],
);

/** Suivi de chaque question dans une séance (temps actif, jalons des aides, statut). */
export const sessionQuestions = sqliteTable(
  'session_questions',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    status: text('status').$type<QuestionStatus>().notNull().default('unseen'),
    activeMs: integer('active_ms').notNull().default(0),
    lastHeartbeatAt: integer('last_heartbeat_at'),
    courseRefsAtMs: integer('course_refs_at_ms'),
    hintAtMs: integer('hint_at_ms'),
    solutionUnlocked: integer('solution_unlocked', { mode: 'boolean' }).notNull().default(false),
    closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
    flags: text('flags', { mode: 'json' }).$type<QuestionFlags>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.questionId] })],
);

/** Détails d’erreur d’une réponse, dévoilés pas à pas. */
export interface AttemptHidden {
  errorLocation: string | null;
  errorExplanation: string | null;
}

/** Réponses envoyées par l’étudiant. */
export const attempts = sqliteTable(
  'attempts',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    type: text('type').$type<AnswerType>().notNull(),
    answerText: text('answer_text'),
    code: text('code'),
    codeLang: text('code_lang'),
    imagePath: text('image_path'),
    verdict: text('verdict').$type<Verdict>().notNull(),
    hidden: text('hidden', { mode: 'json' }).$type<AttemptHidden>(),
    revealed: text('revealed', { mode: 'json' }).$type<('location' | 'explanation')[]>().notNull().default([]),
    submittedAtMs: integer('submitted_at_ms').notNull(),
    shownAtMs: integer('shown_at_ms'),
    explainedAtMs: integer('explained_at_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('attempts_session_idx').on(t.sessionId, t.questionId)],
);

/** Aides obtenues et détails d’erreur dévoilés pendant une séance. */
export const sessionEvents = sqliteTable(
  'session_events',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    kind: text('kind').$type<EventKind>().notNull(),
    attemptId: text('attempt_id'),
    contentMd: text('content_md').notNull().default(''),
    data: text('data', { mode: 'json' }).$type<{ courseRefs?: CourseRef[]; source?: SolutionSource; auto?: boolean }>(),
    createdAt: createdAt(),
  },
  (t) => [index('events_session_idx').on(t.sessionId, t.questionId)],
);

/** Contenu d’un bilan rédigé. */
export type ReportContent = Pick<ReportDto, 'strengthsMd' | 'overallMd' | 'blockingPoints' | 'questions'>;

/** Bilans de fin de séance. */
export const reports = sqliteTable('reports', {
  id: id(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  status: text('status').$type<ReportStatus>().notNull().default('pending'),
  error: text('error'),
  score: real('score'),
  content: text('content', { mode: 'json' }).$type<ReportContent>(),
  createdAt: createdAt(),
});

/** Points bloquants d’un cours. */
export const weakPoints = sqliteTable(
  'weak_points',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    notion: text('notion').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    sectionIds: text('section_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    sourceQuestionIds: text('source_question_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    priority: integer('priority').notNull().default(50),
    status: text('status').$type<WeakPointStatus>().notNull().default('active'),
    successStreak: integer('success_streak').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('weak_points_course_idx').on(t.courseId)],
);

/** Historique de l’évolution des points bloquants. */
export const weakPointEvents = sqliteTable('weak_point_events', {
  id: id(),
  weakPointId: text('weak_point_id')
    .notNull()
    .references(() => weakPoints.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  delta: integer('delta').notNull(),
  note: text('note'),
  createdAt: createdAt(),
});

/** Quiz de révision ou quiz complets. */
export const quizzes = sqliteTable(
  'quizzes',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'),
    kind: text('kind').$type<QuizKind>().notNull(),
    title: text('title').notNull(),
    status: text('status').$type<QuizStatus>().notNull().default('generating'),
    error: text('error'),
    score: integer('score'),
    total: integer('total').notNull().default(0),
    createdAt: createdAt(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('quizzes_course_idx').on(t.courseId)],
);

/** Questions d’un quiz et réponses de l’étudiant. */
export const quizItems = sqliteTable(
  'quiz_items',
  {
    id: id(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    type: text('type').$type<QuizItemType>().notNull(),
    promptMd: text('prompt_md').notNull(),
    choices: text('choices', { mode: 'json' }).$type<string[]>().notNull().default([]),
    correctIndex: integer('correct_index'),
    expectedAnswerMd: text('expected_answer_md'),
    explanationMd: text('explanation_md').notNull().default(''),
    sourceQuestionId: text('source_question_id'),
    weakPointId: text('weak_point_id'),
    userChoice: integer('user_choice'),
    userAnswer: text('user_answer'),
    correct: integer('correct', { mode: 'boolean' }),
    feedbackMd: text('feedback_md'),
    answeredAt: integer('answered_at'),
  },
  (t) => [index('quiz_items_quiz_idx').on(t.quizId)],
);

/** Conversations du chat (une par cours et une par séance). */
export const chatThreads = sqliteTable('chat_threads', {
  id: id(),
  scope: text('scope').$type<'course' | 'session'>().notNull(),
  courseId: text('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  sdkSessionId: text('sdk_session_id'),
  createdAt: createdAt(),
});

/** Messages du chat. */
export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: id(),
    threadId: text('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    contentMd: text('content_md').notNull(),
    imagePath: text('image_path'),
    questionId: text('question_id'),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_thread_idx').on(t.threadId)],
);

/** File des tâches de fond. */
export const jobs = sqliteTable(
  'jobs',
  {
    id: id(),
    type: text('type').$type<JobType>().notNull(),
    courseId: text('course_id'),
    refId: text('ref_id'),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<JobStatus>().notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    message: text('message'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('jobs_course_idx').on(t.courseId), index('jobs_status_idx').on(t.status)],
);

/** Journal des appels à l’IA (coût, jetons, durée), pour la page Statistiques. */
export const aiCalls = sqliteTable('ai_calls', {
  id: id(),
  task: text('task').notNull(),
  model: text('model').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  costUsd: real('cost_usd').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  error: text('error'),
  createdAt: createdAt(),
});
