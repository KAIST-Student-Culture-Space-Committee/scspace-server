CREATE TABLE `penalty` (
  `id` int AUTO_INCREMENT NOT NULL,
  `target_type` int NOT NULL,
  `user_id` int NULL,
  `organization_id` int NULL,
  `space_type` int NOT NULL,
  `notice` int NOT NULL DEFAULT 0,
  `warning` int NOT NULL DEFAULT 0,
  `notice_total` int NOT NULL DEFAULT 0,
  `warning_total` int NOT NULL DEFAULT 0,
  `converted` boolean NOT NULL DEFAULT false,
  `restriction_stage` int NOT NULL DEFAULT 0,
  `restriction_end` bigint NOT NULL DEFAULT 0,
  `reason` varchar(1024) NOT NULL,
  `issuer_id` int NULL,
  `time_impose` bigint NOT NULL,
  CONSTRAINT `penalty_id_unique` UNIQUE(`id`),
  CONSTRAINT `penalty_id` PRIMARY KEY(`id`),
  CONSTRAINT `penalty_kind_check` CHECK (`notice` IN (0, 1) AND `warning` IN (0, 1) AND `notice` + `warning` = 1)
);
ALTER TABLE `penalty` ADD CONSTRAINT `penalty_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `penalty` ADD CONSTRAINT `penalty_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `penalty` ADD CONSTRAINT `penalty_issuer_id_user_id_fk` FOREIGN KEY (`issuer_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX `penalty_user_type_idx` ON `penalty` (`user_id`, `space_type`, `time_impose`);
CREATE INDEX `penalty_org_type_idx` ON `penalty` (`organization_id`, `space_type`, `time_impose`);
