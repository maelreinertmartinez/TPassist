CREATE TABLE `notions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`parent_id` text,
	`order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'concept' NOT NULL,
	`section_ids` text DEFAULT '[]' NOT NULL,
	`prerequisite_ids` text DEFAULT '[]' NOT NULL,
	`detail_md` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notions_course_idx` ON `notions` (`course_id`);--> statement-breakpoint
ALTER TABLE `courses` ADD `notions_signature` text;--> statement-breakpoint
ALTER TABLE `courses` ADD `notions_generated_at` integer;