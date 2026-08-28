ALTER TABLE `rental`
    ADD COLUMN `overdue_contacted_at` bigint NOT NULL DEFAULT 0,
    ADD COLUMN `overdue_contacted_by_id` int NULL,
    ADD CONSTRAINT `rental_overdue_contacted_by_id_user_id_fk`
        FOREIGN KEY (`overdue_contacted_by_id`) REFERENCES `user`(`id`)
        ON DELETE SET NULL ON UPDATE NO ACTION;
