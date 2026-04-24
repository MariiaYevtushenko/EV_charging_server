-- Додати країну до location (узгоджено з server/SQL_scripts/DB_script.MD).
-- Виконати один раз на існуючій БД, якщо колонки ще немає.

ALTER TABLE location
  ADD COLUMN IF NOT EXISTS country VARCHAR(100) NOT NULL DEFAULT 'UA';

-- Після backfill можна прибрати DEFAULT, якщо потрібно жорстко вимагати країну в додатку:
-- ALTER TABLE location ALTER COLUMN country DROP DEFAULT;
