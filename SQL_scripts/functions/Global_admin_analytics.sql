
-- VIEW View_Admin_SessionStatisticByPortType_30 та View_Admin_Top10MostProfitableCountries_30 — у ../View.sql
-- (щоб один скрипт View.sql створював усі представлення для UI).

-- Глобальний адмін: сесії за 30 днів за типом конектора порту (джерело для globalAdminAnalyticsRepository.networkPortTypeStats).
-- Раніше було лише в functions/Global_admin_analytics.sql — застосуйте цей файл після DDL і потрібних функцій.
CREATE OR REPLACE VIEW View_Admin_SessionStatisticByPortType_30 AS
SELECT
  ct.id AS connector_type_id,
  ct.name::TEXT AS connector_type_name,
  COUNT(s.id)::BIGINT AS total_sessions,
  COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
  COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
FROM session s
JOIN port p ON p.station_id = s.station_id AND p.port_number = s.port_number
LEFT JOIN connector_type ct ON ct.id = p.connector_type_id
LEFT JOIN bill b ON b.session_id = s.id
WHERE s.start_time >= now() - INTERVAL '30 days'
GROUP BY ct.id, ct.name
ORDER BY COUNT(s.id) DESC NULLS LAST, ct.id NULLS LAST;


-- Глобальний адмін: топ країн за прибутком за 30 днів (globalAdminAnalyticsRepository.networkTopCountries → view_admintop10mostprofitablecountries_30).
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
-- ГОТОВА ОСТАТОЧНО
-- Отримання загальних показників сесій за період
CREATE OR REPLACE FUNCTION GetSummarySessionStatisticByPeriod(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  total_sessions INT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_duration_minutes NUMERIC,
  avg_kwh NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(s.id) AS total_sessions,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue,
    ROUND(
      AVG(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60.0) FILTER (WHERE s.end_time IS NOT NULL),
      2
    ) AS avg_duration_minutes,
    ROUND(
      AVG(s.kwh_consumed) FILTER (WHERE s.status = 'COMPLETED'::session_status),
      3
    ) AS avg_kwh,
    ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2) AS avg_bill_amount
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.start_time >= p_date_from
    AND s.start_time < p_date_to;
$$;


-- Сумісність: ті самі агрегати, що GetSummarySessionStatisticByPeriod (один запит у джерелі).
CREATE OR REPLACE FUNCTION GetAdminRevenueForPeriod(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.total_sessions::BIGINT AS session_count,
    s.total_kwh,
    s.total_revenue,
    s.avg_bill_amount
  FROM GetSummarySessionStatisticByPeriod(p_date_from, p_date_to) AS s;
$$;


-- ГОТОВА ОСТАТОЧНО
-- Отримання статистики за днями за період
CREATE OR REPLACE FUNCTION GetAdminRevenueTrendByDays(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  bucket_date DATE,
  session_count BIGINT,
  booking_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH day_bounds AS (
    SELECT
      (p_date_from AT TIME ZONE 'UTC')::DATE AS d_from,
      (p_date_to AT TIME ZONE 'UTC')::DATE
        - CASE
            WHEN (p_date_to AT TIME ZONE 'UTC')::TIME = TIME '00:00:00' THEN 1
            ELSE 0
          END AS d_to_inclusive
  ),
  day_series AS (
    SELECT gs::DATE AS bucket_date
    FROM day_bounds b,
    generate_series(b.d_from, b.d_to_inclusive, INTERVAL '1 day') AS gs
    WHERE b.d_from <= b.d_to_inclusive
  ),
  session_info AS (
    SELECT
      (s.start_time AT TIME ZONE 'UTC')::DATE AS bucket_date,
      COUNT(s.id) AS session_count,
      COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
      COALESCE(SUM(b.calculated_amount), 0) AS total_revenue
    FROM session s
    LEFT JOIN bill b ON b.session_id = s.id
    WHERE s.start_time >= p_date_from
      AND s.start_time < p_date_to
    GROUP BY bucket_date
  ),
  booking_info AS (
    SELECT
      (bk.start_time AT TIME ZONE 'UTC')::DATE AS bucket_date,
      COUNT(bk.id)::BIGINT AS booking_count
    FROM booking bk
    WHERE bk.start_time >= p_date_from
      AND bk.start_time < p_date_to
    GROUP BY 1
  )
  SELECT
    d.bucket_date,
    COALESCE(s.session_count, 0)::BIGINT,
    COALESCE(b.booking_count, 0)::BIGINT,
    COALESCE(s.total_kwh, 0),
    COALESCE(s.total_revenue, 0)
  FROM day_series d
  LEFT JOIN session_info s ON s.bucket_date = d.bucket_date
  LEFT JOIN booking_info b ON b.bucket_date = d.bucket_date
  ORDER BY 1;
$$;

-- ГОТОВА ОСТАТОЧНО
-- Отримання статистики сесій за типом бронювання за період
-- Типи сесій: без бронювання, з бронюванням (DEPOSIT), з бронюванням (CALC)
CREATE OR REPLACE FUNCTION GetAdminSessionStatsByBookingKindForPeriod(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  session_kind TEXT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH kinds AS (
    SELECT unnest(ARRAY['NO_BOOKING', 'WITH_BOOKING_CALC', 'WITH_BOOKING_DEPOSIT']::TEXT[]) AS session_kind
  ),
  session_info AS (
    SELECT
      CASE
        WHEN s.booking_id IS NULL THEN 'NO_BOOKING'::TEXT
        WHEN bk.booking_type = 'CALC'::booking_type THEN 'WITH_BOOKING_CALC'::TEXT
        WHEN bk.booking_type = 'DEPOSIT'::booking_type THEN 'WITH_BOOKING_DEPOSIT'::TEXT
      END AS session_kind,
      s.id,
      s.kwh_consumed,
      b.calculated_amount
    FROM session s
    LEFT JOIN bill b ON b.session_id = s.id
    LEFT JOIN booking bk ON bk.id = s.booking_id
    WHERE s.start_time >= p_date_from
      AND s.start_time < p_date_to
      AND s.status = 'COMPLETED'::session_status
  ),
  session_info_agg AS (
    SELECT
      session_kind,
      COUNT(id) AS session_count,
      COALESCE(SUM(kwh_consumed), 0) AS total_kwh,
      COALESCE(SUM(calculated_amount), 0) AS total_revenue,
      ROUND(AVG(calculated_amount) FILTER (WHERE calculated_amount IS NOT NULL), 2) AS avg_bill_amount
    FROM session_info
    WHERE session_kind IS NOT NULL
    GROUP BY session_kind
  )
  SELECT
    k.session_kind AS session_kind,
    COALESCE(a.session_count, 0) AS session_count,
    COALESCE(a.total_kwh, 0) AS total_kwh,
    COALESCE(a.total_revenue, 0) AS total_revenue,
    a.avg_bill_amount AS avg_bill_amount
  FROM kinds k
  LEFT JOIN session_info_agg a USING (session_kind)
  ORDER BY session_kind;
$$;


CREATE OR REPLACE VIEW View_Admin_SessionStatsByBookingKind_30 AS
SELECT *
FROM getadminsessionstatsbybookingkindforperiod(now() - INTERVAL '30 days', now());

