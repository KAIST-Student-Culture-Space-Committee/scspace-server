INSERT INTO `space` (`id`, `name_kr`, `name_en`, `space_type`)
SELECT 17, '신학관 옥상', 'Student Center Rooftop', 8
WHERE NOT EXISTS (
    SELECT 1
    FROM `space`
    WHERE `id` = 17 OR `name_en` = 'Student Center Rooftop'
);
