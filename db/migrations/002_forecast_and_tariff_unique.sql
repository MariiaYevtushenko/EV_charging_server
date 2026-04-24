-- Доповнення до вже застосованого DB_script.MD: якщо таблиці вже створені з SQL з DB_script.MD,
-- виконайте лише те, чого бракує (унікальні ключі на tariff / tariff_prediction).

ALTER TABLE tariff
  DROP CONSTRAINT IF EXISTS tariff_tariff_type_effective_date_key;

ALTER TABLE tariff
  ADD CONSTRAINT tariff_tariff_type_effective_date_key UNIQUE (tariff_type, effective_date);

ALTER TABLE tariff_prediction
  DROP CONSTRAINT IF EXISTS tariff_prediction_target_date_tariff_type_key;

ALTER TABLE tariff_prediction
  ADD CONSTRAINT tariff_prediction_target_date_tariff_type_key UNIQUE (target_date, tariff_type);
