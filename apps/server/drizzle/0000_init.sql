CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`ok` integer NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`question_id` text NOT NULL,
	`type` text NOT NULL,
	`answer_text` text,
	`code` text,
	`code_lang` text,
	`image_path` text,
	`verdict` text NOT NULL,
	`hidden` text,
	`revealed` text DEFAULT '[]' NOT NULL,
	`submitted_at_ms` integer NOT NULL,
	`shown_at_ms` integer,
	`explained_at_ms` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_session_idx` ON `attempts` (`session_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content_md` text NOT NULL,
	`image_path` text,
	`question_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_thread_idx` ON `chat_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`course_id` text NOT NULL,
	`session_id` text,
	`sdk_session_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `course_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`course_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`page_start` integer,
	`page_end` integer,
	`summary` text DEFAULT '' NOT NULL,
	`key_concepts` text DEFAULT '[]' NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sections_unit_idx` ON `course_sections` (`unit_id`);--> statement-breakpoint
CREATE INDEX `sections_course_idx` ON `course_sections` (`course_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#4f46e5' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`filename` text NOT NULL,
	`path` text NOT NULL,
	`page_count` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`pages_text` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_course_idx` ON `documents` (`course_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`context_md` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercises_unit_idx` ON `exercises` (`unit_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`course_id` text,
	`ref_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_course_idx` ON `jobs` (`course_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `question_ai_cache` (
	`question_id` text NOT NULL,
	`kind` text NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`question_id`, `kind`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`document_id` text,
	`order` integer DEFAULT 0 NOT NULL,
	`label` text NOT NULL,
	`statement_md` text NOT NULL,
	`figure_pages` text DEFAULT '[]' NOT NULL,
	`depends_on_previous` integer DEFAULT false NOT NULL,
	`points` real,
	`official_solution_md` text,
	`official_solution_doc_id` text,
	`official_solution_pages` text,
	`weak_point_id` text,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_unit_idx` ON `questions` (`unit_id`);--> statement-breakpoint
CREATE INDEX `questions_exercise_idx` ON `questions` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `quiz_items` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`order` integer NOT NULL,
	`type` text NOT NULL,
	`prompt_md` text NOT NULL,
	`choices` text DEFAULT '[]' NOT NULL,
	`correct_index` integer,
	`expected_answer_md` text,
	`explanation_md` text DEFAULT '' NOT NULL,
	`source_question_id` text,
	`weak_point_id` text,
	`user_choice` integer,
	`user_answer` text,
	`correct` integer,
	`feedback_md` text,
	`answered_at` integer,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_items_quiz_idx` ON `quiz_items` (`quiz_id`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`session_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`error` text,
	`score` integer,
	`total` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quizzes_course_idx` ON `quizzes` (`course_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`score` real,
	`content` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`question_id` text NOT NULL,
	`kind` text NOT NULL,
	`attempt_id` text,
	`content_md` text DEFAULT '' NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `session_events` (`session_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `session_questions` (
	`session_id` text NOT NULL,
	`question_id` text NOT NULL,
	`order` integer NOT NULL,
	`status` text DEFAULT 'unseen' NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`last_heartbeat_at` integer,
	`course_refs_at_ms` integer,
	`hint_at_ms` integer,
	`solution_unlocked` integer DEFAULT false NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`flags` text NOT NULL,
	PRIMARY KEY(`session_id`, `question_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`current_question_id` text,
	`time_limit_sec` integer,
	`elapsed_sec` real DEFAULT 0 NOT NULL,
	`last_tick_at` integer,
	`score` real,
	`review_quiz_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_course_idx` ON `sessions` (`course_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`document_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`page_start` integer,
	`page_end` integer,
	`origin` text DEFAULT 'imported' NOT NULL,
	`corrects_unit_id` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `units_course_idx` ON `units` (`course_id`);--> statement-breakpoint
CREATE INDEX `units_document_idx` ON `units` (`document_id`);--> statement-breakpoint
CREATE TABLE `weak_point_events` (
	`id` text PRIMARY KEY NOT NULL,
	`weak_point_id` text NOT NULL,
	`source` text NOT NULL,
	`delta` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`weak_point_id`) REFERENCES `weak_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `weak_points` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`notion` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`section_ids` text DEFAULT '[]' NOT NULL,
	`source_question_ids` text DEFAULT '[]' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`success_streak` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `weak_points_course_idx` ON `weak_points` (`course_id`);