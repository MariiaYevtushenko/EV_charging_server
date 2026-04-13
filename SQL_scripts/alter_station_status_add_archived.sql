-- Додати ARCHIVED до переліку station_status (узгоджено з Prisma та archiveStation).
-- Виконайте один раз проти існуючої БД, якщо отримуєте помилку про неприпустиме значення ARCHIVED.
--
-- PostgreSQL 9.1+: можна повторно без помилки
ALTER TYPE station_status ADD VALUE IF NOT EXISTS 'ARCHIVED';
