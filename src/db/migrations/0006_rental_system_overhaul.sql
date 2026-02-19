CREATE TABLE `goods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(4098),
	`count_all` int NOT NULL DEFAULT 1,
	`count_now` int NOT NULL,
	`image_uri` varchar(256),
	CONSTRAINT `goods_id_unique` UNIQUE(`id`),
	CONSTRAINT `goods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rental` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`goods_id` int NOT NULL,
	`count` int NOT NULL DEFAULT 1,
	`time_borrow` bigint NOT NULL,
	`time_due` bigint NOT NULL,
	`time_return` bigint NOT NULL DEFAULT 0,
	`time_confirm` bigint NOT NULL DEFAULT 0,
	`cert_name` varchar(256) NOT NULL,
	`group_name` varchar(128),
	`contact` varchar(64),
	`emergency_contact` varchar(64),
	`using_location` varchar(256),
	`using_purpose` varchar(512),
	`approver_id` int,
	`return_approver_id` int,
	`status` int NOT NULL DEFAULT 0,
	CONSTRAINT `rental_id_unique` UNIQUE(`id`),
	CONSTRAINT `rental_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `rental` ADD CONSTRAINT `rental_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `rental` ADD CONSTRAINT `rental_goods_id_goods_id_fk` FOREIGN KEY (`goods_id`) REFERENCES `goods`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `rental` ADD CONSTRAINT `rental_approver_id_user_id_fk` FOREIGN KEY (`approver_id`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `rental` ADD CONSTRAINT `rental_return_approver_id_user_id_fk` FOREIGN KEY (`return_approver_id`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE `rental` SET `status` = CASE 
  WHEN `time_confirm` > 0 THEN 2
  WHEN `time_return` > 0 THEN 1
  ELSE 0
END WHERE `status` = 0;
