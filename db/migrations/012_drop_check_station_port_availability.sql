-- Прибрати тригер перевірки бронювання на станцію/порт (CheckStationPortAvailability).
-- Виконати на БД, де тригер уже створено з попередніх версій Triggers.sql / 011.

DROP TRIGGER IF EXISTS trigger_checkstationportavailability ON booking;
DROP FUNCTION IF EXISTS checkstationportavailability();
