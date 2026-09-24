ALTER TABLE `reservation_content` ADD `performance` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE `reservation_content` AS rc
JOIN `reservation` AS r ON r.`id` = rc.`id`
SET rc.`performance` = true
WHERE r.`title` LIKE '공연집중기간 예약%';
