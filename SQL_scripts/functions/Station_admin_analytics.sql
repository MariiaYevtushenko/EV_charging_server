-- =============================================================================
-- Аналітика для адміна станцій (мережа + одна станція за p_station_id)
-- Період: [p_date_from, p_date_to) за start_time сесії / бронювання.
-- =============================================================================


-- Порти станції за останні 30 днів: кількість сесій, спожита енергія (кВт·год), виручка з bill.

CREATE OR REPLACE VIEW View_StationPortStatsLast30Days AS
SELECT
  p.station_id,
  st.name::TEXT AS station_name,
  p.port_number,
  COALESCE(ct.name, '—')::TEXT AS connector_name,
  COUNT(s.id)::BIGINT AS total_sessions,
  COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_energy,
  COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
FROM port p
JOIN station st ON st.id = p.station_id
LEFT JOIN connector_type ct ON ct.id = p.connector_type_id
LEFT JOIN session s
  ON s.station_id = p.station_id
 AND s.port_number = p.port_number
 AND s.start_time >= now() - interval '30 days'
LEFT JOIN bill b ON b.session_id = s.id
GROUP BY p.station_id, st.name, p.port_number, ct.name;


-- Один рядок на станцію: сесії за останні 30 днів, середня тривалість (хв), середній kWh, виручка, середній чек (де є bill).
-- Замість GetStationSessionStatsForPeriod(..., now()-30d, now()) — зріз фіксований у визначенні VIEW.

CREATE OR REPLACE VIEW View_StationSessionStatsLast30Days AS
SELECT
  st.id AS station_id,
  st.name::TEXT AS station_name,
  COUNT(s.id)::BIGINT AS total_sessions,
  ROUND(
    AVG(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60.0)
    FILTER (WHERE s.end_time IS NOT NULL),
    2
  ) AS avg_duration_minutes,
  ROUND(AVG(s.kwh_consumed) FILTER (WHERE s.status = 'COMPLETED'::session_status), 3) AS avg_kwh,
  COALESCE(SUM(b.calculated_amount), 0) AS total_revenue,
  ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2) AS avg_bill_amount
FROM station st
LEFT JOIN session s
  ON s.station_id = st.id
 AND s.start_time >= now() - interval '30 days'
LEFT JOIN bill b ON b.session_id = s.id
GROUP BY st.id, st.name;



-- ТОП станцій за кількістю сесій у періоді
CREATE OR REPLACE FUNCTION GetNetworkStationsMostSessions(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(station_id INT, station_name TEXT, session_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    st.id,
    st.name::TEXT,
    COUNT(s.id)::BIGINT
  FROM station st
  LEFT JOIN session s
    ON s.station_id = st.id
   AND s.start_time >= p_date_from
   AND s.start_time < p_date_to
  GROUP BY st.id, st.name
  ORDER BY COUNT(s.id) DESC NULLS LAST, st.id
  LIMIT (SELECT LEAST(50, GREATEST(1, COALESCE(p_limit, 10)))::INT);
$$;


-- Найменш завантажені станції (сесії за період, зростання)
CREATE OR REPLACE FUNCTION GetNetworkStationsFewestSessions(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(station_id INT, station_name TEXT, session_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    st.id as station_id,
    st.name as station_name,
    COUNT(s.id) as session_count
  FROM station st
  JOIN session s ON s.station_id = st.id
  WHERE s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY st.id, st.name
  ORDER BY session_count ASC NULLS FIRST, st.id
  LIMIT (SELECT LEAST(50, GREATEST(1, COALESCE(p_limit, 10))));
$$;



--- ОК 
-- Пікові години: ISO-день тижня (1=Пн … 7=Нд), година 0–23
CREATE OR REPLACE FUNCTION GetStationPeakHourBuckets(
  p_station_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(iso_dow INT, hour_of_day INT, session_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXTRACT(ISODOW FROM s.start_time) as iso_dow,
    EXTRACT(HOUR FROM s.start_time) as hour_of_day,
    COUNT(*) AS session_count
  FROM session s
  WHERE s.station_id = p_station_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY iso_dow, hour_of_day
  ORDER BY iso_dow, hour_of_day;
$$;


-- Підсумки сесій однієї станції за [p_date_from, p_date_to) — та сама логіка, що View_StationSessionStatsLast30Days, з довільним вікном.
CREATE OR REPLACE FUNCTION GetStationSessionStatsForPeriod(
  p_station_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_sessions BIGINT,
  avg_duration_minutes NUMERIC,
  avg_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(s.id)::BIGINT AS total_sessions,
    ROUND(
      AVG(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60.0)
      FILTER (WHERE s.end_time IS NOT NULL),
      2
    ) AS avg_duration_minutes,
    ROUND(AVG(s.kwh_consumed) FILTER (WHERE s.status = 'COMPLETED'::session_status), 3) AS avg_kwh,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue,
    ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2) AS avg_bill_amount
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.station_id = p_station_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to;
$$;


-- Порти станції за [p_date_from, p_date_to): сесії, kWh, виручка (як View_StationPortStatsLast30Days, з датами).
CREATE OR REPLACE FUNCTION GetStationPortMetricsForPeriod(
  p_station_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  port_number INT,
  connector_name TEXT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.port_number,
    COALESCE(ct.name, '—')::TEXT AS connector_name,
    COUNT(s.id)::BIGINT AS session_count,
    COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
  FROM port p
  LEFT JOIN connector_type ct ON ct.id = p.connector_type_id
  LEFT JOIN session s
    ON s.station_id = p.station_id
   AND s.port_number = p.port_number
   AND s.start_time >= p_date_from
   AND s.start_time < p_date_to
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE p.station_id = p_station_id
  GROUP BY p.port_number, ct.name
  ORDER BY p.port_number;
$$;
