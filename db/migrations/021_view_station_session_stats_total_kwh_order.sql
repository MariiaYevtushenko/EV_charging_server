-- Додано total_kwh (сума спожитої енергії за вікно) і порядок за замовчуванням: прибуток → kWh → сесії.
-- PostgreSQL не дозволяє CREATE OR REPLACE VIEW, якщо змінюється порядок/кількість стовпців (42P16:
-- «змінити ім'я стовпця total_revenue на total_kwh … неможливо») — спочатку DROP.
DROP VIEW IF EXISTS View_StationSessionStatsLast30Days CASCADE;

CREATE VIEW View_StationSessionStatsLast30Days AS
SELECT
  st.id AS station_id,
  st.name::TEXT AS station_name,
  COUNT(s.id) AS total_sessions,
  ROUND(
    AVG(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60.0)
    FILTER (WHERE s.end_time IS NOT NULL),
    2
  ) AS avg_duration_minutes,
  ROUND(AVG(s.kwh_consumed) FILTER (WHERE s.status = 'COMPLETED'::session_status), 3) AS avg_kwh,
  COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
  COALESCE(SUM(b.calculated_amount), 0) AS total_revenue,
  ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2) AS avg_bill_amount
FROM station st
LEFT JOIN session s
  ON s.station_id = st.id
 AND s.start_time >= now() - interval '30 days'
LEFT JOIN bill b ON b.session_id = s.id
GROUP BY st.id, st.name
ORDER BY total_revenue DESC NULLS LAST, total_kwh DESC NULLS LAST, total_sessions DESC NULLS LAST;
