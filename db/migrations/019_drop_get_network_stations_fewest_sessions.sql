-- Рейтинг «найменш завантажених» прибрано з аналітики адміна станцій.
DROP FUNCTION IF EXISTS getnetworkstationsfewestsessions(timestamptz, timestamptz, integer);
