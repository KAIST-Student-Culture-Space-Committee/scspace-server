ALTER TABLE `s_lottery` ADD `priority` int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `s_lottery` ALTER COLUMN `priority` DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE `s_lottery` ADD CONSTRAINT `s_lottery_priority_range` CHECK (`priority` BETWEEN 1 AND 3);
