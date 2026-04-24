-- "view_adminglobaldashboard"
-- "view_admin_sessionstatisticbyporttype_30"
-- "view_admin_top10mostprofitablecountries_30"
-- "view_admin_sessionstatsbybookingkind_30"
-- "view_stationsessionstatslast30days"


-- Глобальний адмін: останні 30 календарних днів vs попередні 30 (лише сесії з bill) — для огляду аналітики.
CREATE OR REPLACE VIEW View_AdminGlobalDashboard AS
WITH stats_current AS (
    SELECT
        COALESCE(SUM(b.calculated_amount), 0) AS rev,
        COALESCE(SUM(s.kwh_consumed), 0) AS energy,
        COUNT(DISTINCT s.vehicle_id) AS cars,
        COUNT(s.id) AS sessions
    FROM bill b
    JOIN session s ON b.session_id = s.id
    WHERE s.start_time >= now() - interval '30 days'
),
stats_previous AS (
    SELECT
        COALESCE(SUM(b.calculated_amount), 0) AS rev,
        COALESCE(SUM(s.kwh_consumed), 0) AS energy,
        COUNT(DISTINCT s.vehicle_id) AS cars,
        COUNT(s.id) AS sessions
    FROM bill b
    JOIN session s ON b.session_id = s.id
    WHERE s.start_time >= now() - interval '60 days' AND s.start_time < now() - interval '30 days'
)
SELECT
    curr.rev AS revenue_30d,
    curr.energy AS energy_30d,
    curr.cars AS unique_cars_30d,
    curr.sessions AS sessions_30d,
    prev.rev AS revenue_prev_30d,
    prev.energy AS energy_prev_30d,
    prev.cars AS unique_cars_prev_30d,
    prev.sessions AS sessions_prev_30d,
    ROUND(((curr.rev - prev.rev) / NULLIF(prev.rev, 0)) * 100, 2) AS rev_growth_pct,
    ROUND(((curr.energy - prev.energy) / NULLIF(prev.energy, 0)) * 100, 2) AS energy_growth_pct,
    ROUND(((curr.cars - prev.cars) / NULLIF(prev.cars, 0)) * 100, 2) AS cars_growth_pct,
    ROUND(((curr.sessions - prev.sessions) / NULLIF(prev.sessions, 0)) * 100, 2) AS sessions_growth_pct
FROM stats_current curr
CROSS JOIN stats_previous prev;




-- ВСЕ ОК, ВИКОРИСТОВУЄТЬСЯ
-- Отримання статистики по типу портів
CREATE OR REPLACE VIEW View_Admin_SessionStatisticByPortType_30 AS
SELECT
  ct.id AS connector_type_id,
  ct.name::TEXT AS connector_type_name,
  COUNT(s.id) AS total_sessions,
  COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
  COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
FROM session s
JOIN port p ON p.station_id = s.station_id AND p.port_number = s.port_number
LEFT JOIN connector_type ct ON ct.id = p.connector_type_id
LEFT JOIN bill b ON b.session_id = s.id
WHERE s.start_time >= now() - INTERVAL '30 days'
GROUP BY ct.id, ct.name
ORDER BY COUNT(s.id) DESC NULLS LAST, ct.id NULLS LAST;


-- Глобальний адмін
-- топ країн за прибутком за 30 днів 
CREATE OR REPLACE VIEW View_Admin_Top10MostProfitableCountries_30 AS
SELECT
  l.country AS country_name,
  COALESCE(SUM(b.calculated_amount), 0) AS total_revenue
FROM session s
JOIN bill b ON b.session_id = s.id
JOIN station st ON st.id = s.station_id
JOIN location l ON l.id = st.location_id
WHERE s.start_time >= now() - INTERVAL '30 days'
  AND s.status = 'COMPLETED'::session_status
GROUP BY l.country
ORDER BY total_revenue DESC NULLS LAST, country_name NULLS LAST
LIMIT 10;


-- Отримання статистики по типу бронювань за 30 днів
CREATE OR REPLACE VIEW View_Admin_SessionStatsByBookingKind_30 AS
SELECT *
FROM getadminsessionstatsbybookingkindforperiod(now() - INTERVAL '30 days', now());


-- ========================================================================================
-- АДМІНІСТРАТОР СТАНЦІЙ
-- ========================================================================================
-- ВСЕ ОК, ВИКОРИСТОВУЄТЬСЯ
-- Один рядок на станцію: сесії за останні 30 днів, середня тривалість (хв), середній kWh, прибуток, середній чек (де є bill).
-- Замість GetStationSessionStatsForPeriod(..., now()-30d, now()) — зріз фіксований у визначенні VIEW.
CREATE OR REPLACE VIEW View_StationSessionStatsLast30Days AS
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


-- Порти: сесії / kWh / виручка за останні 30 днів (для station admin analytics + пагінація).
CREATE OR REPLACE VIEW View_StationPortStatsLast30Days AS
SELECT
  p.station_id,
  p.port_number,
  ct.name::TEXT AS connector_name,
  COUNT(s.id) AS total_sessions,
  COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_energy,
  COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
FROM port p
JOIN connector_type ct ON ct.id = p.connector_type_id
LEFT JOIN session s
  ON s.station_id = p.station_id
 AND s.port_number = p.port_number
 AND s.start_time >= now() - INTERVAL '30 days'
LEFT JOIN bill b ON b.session_id = s.id
GROUP BY p.station_id, p.port_number, ct.name
ORDER BY p.station_id, p.port_number;
