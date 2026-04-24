-- Видалити колонку power_rate з vehicle (узгоджено з DB_script.MD / Prisma).
ALTER TABLE vehicle DROP COLUMN IF EXISTS power_rate;
