-- =============================================================================
-- Аналітика глобального адміна (мережа за періодом [p_date_from, p_date_to))
-- Сесії: start_time; броні: start_time booking.
-- =============================================================================

-- Мережа: сесії, середня тривалість (хв), середній kWh (COMPLETED), виручка, середній чек
CREATE OR REPLACE FUNCTION GetAdminNetworkSessionStatsForPeriod(
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
    COUNT(s.id)::BIGINT,
    ROUND(
      AVG(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60.0) FILTER (WHERE s.end_time IS NOT NULL),
      2
    ),
    ROUND(AVG(s.kwh_consumed) FILTER (WHERE s.status = 'COMPLETED'::session_status), 3),
    COALESCE(SUM(b.calculated_amount), 0),
    ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2)
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.start_time >= p_date_from
    AND s.start_time < p_date_to;
$$;


-- Виручка та сесії по станції
CREATE OR REPLACE FUNCTION GetAdminNetworkRevenueByStationForPeriod(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  station_id INT,
  station_name TEXT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    st.id,
    st.name::TEXT,
    COUNT(s.id)::BIGINT,
    COALESCE(SUM(s.kwh_consumed), 0),
    COALESCE(SUM(b.calculated_amount), 0),
    ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2)
  FROM station st
  LEFT JOIN session s
    ON s.station_id = st.id
   AND s.start_time >= p_date_from
   AND s.start_time < p_date_to
  LEFT JOIN bill b ON b.session_id = s.id
  GROUP BY st.id, st.name
  ORDER BY COALESCE(SUM(b.calculated_amount), 0) DESC NULLS LAST, st.id;
$$;


-- Виручка по кожному порту мережі (останні порти з сесіями зверху)
CREATE OR REPLACE FUNCTION GetAdminNetworkRevenueByPortForPeriod(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP,
  p_limit INT DEFAULT 500
)
RETURNS TABLE(
  station_id INT,
  station_name TEXT,
  port_number INT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    st.id,
    st.name::TEXT,
    p.port_number,
    COUNT(s.id)::BIGINT,
    COALESCE(SUM(s.kwh_consumed), 0),
    COALESCE(SUM(b.calculated_amount), 0),
    ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2)
  FROM port p
  JOIN station st ON st.id = p.station_id
  LEFT JOIN session s
    ON s.station_id = p.station_id
   AND s.port_number = p.port_number
   AND s.start_time >= p_date_from
   AND s.start_time < p_date_to
  LEFT JOIN bill b ON b.session_id = s.id
  GROUP BY st.id, st.name, p.port_number
  ORDER BY COALESCE(SUM(b.calculated_amount), 0) DESC NULLS LAST, st.id, p.port_number
  LIMIT (SELECT LEAST(2000, GREATEST(1, COALESCE(p_limit, 500)))::INT);
$$;


-- Пікові години мережі (ISO день тижня 1–7, година 0–23)
CREATE OR REPLACE FUNCTION GetAdminNetworkPeakHourBuckets(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(iso_dow INT, hour_of_day INT, session_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXTRACT(ISODOW FROM s.start_time)::INT,
    EXTRACT(HOUR FROM s.start_time)::INT,
    COUNT(*)::BIGINT
  FROM session s
  WHERE s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;


-- Денна динаміка виручки та kWh (для графіків)
CREATE OR REPLACE FUNCTION GetAdminNetworkRevenueTrendDailyForPeriod(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  bucket_date DATE,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (s.start_time AT TIME ZONE 'UTC')::DATE,
    COUNT(s.id)::BIGINT,
    COALESCE(SUM(s.kwh_consumed), 0),
    COALESCE(SUM(b.calculated_amount), 0)
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY 1
  ORDER BY 1;
$$;


-- Проксі «день / ніч» тарифу: за годиною старту сесії (07:00–21:59 — денне вікно)
CREATE OR REPLACE FUNCTION GetAdminNetworkDayNightRevenueProxyForPeriod(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  band TEXT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN EXTRACT(HOUR FROM s.start_time) BETWEEN 7 AND 21 THEN 'DAY_WINDOW'::TEXT
      ELSE 'NIGHT_WINDOW'::TEXT
    END,
    COUNT(s.id)::BIGINT,
    COALESCE(SUM(s.kwh_consumed), 0),
    COALESCE(SUM(b.calculated_amount), 0)
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY 1
  ORDER BY 1;
$$;


-- Міста з найвищим навантаженням (проксі «location intelligence»)
CREATE OR REPLACE FUNCTION GetAdminNetworkCityHotspotsForPeriod(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP,
  p_limit INT DEFAULT 15
)
RETURNS TABLE(
  city TEXT,
  station_count BIGINT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  sessions_per_station NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l.city::TEXT,
    COUNT(DISTINCT st.id)::BIGINT,
    COUNT(s.id)::BIGINT,
    COALESCE(SUM(s.kwh_consumed), 0),
    COALESCE(SUM(b.calculated_amount), 0),
    ROUND(
      COUNT(s.id)::NUMERIC / NULLIF(COUNT(DISTINCT st.id), 0),
      2
    )
  FROM location l
  JOIN station st ON st.location_id = l.id
  LEFT JOIN session s
    ON s.station_id = st.id
   AND s.start_time >= p_date_from
   AND s.start_time < p_date_to
  LEFT JOIN bill b ON b.session_id = s.id
  GROUP BY l.city
  ORDER BY COUNT(s.id) DESC NULLS LAST, l.city
  LIMIT (SELECT LEAST(50, GREATEST(1, COALESCE(p_limit, 15)))::INT);
$$;


-- Зв'язок бронювань і сесій за періодом броні
CREATE OR REPLACE FUNCTION GetAdminNetworkBookingSessionMetricsForPeriod(
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_bookings BIGINT,
  completed_bookings BIGINT,
  bookings_with_session BIGINT,
  pct_bookings_with_session NUMERIC,
  total_sessions BIGINT,
  sessions_with_booking BIGINT,
  pct_sessions_from_booking NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bk AS (
    SELECT
      id,
      status
    FROM booking
    WHERE start_time >= p_date_from
      AND start_time < p_date_to
  ),
  sess AS (
    SELECT
      id,
      booking_id
    FROM session
    WHERE start_time >= p_date_from
      AND start_time < p_date_to
  )
  SELECT
    (SELECT COUNT(*)::BIGINT FROM bk),
    (SELECT COUNT(*)::BIGINT FROM bk WHERE status = 'COMPLETED'::booking_status),
    (
      SELECT COUNT(*)::BIGINT
      FROM bk b
      WHERE EXISTS (SELECT 1 FROM session s WHERE s.booking_id = b.id)
    ),
    CASE
      WHEN (SELECT COUNT(*) FROM bk) = 0 THEN NULL
      ELSE ROUND(
        100.0 * (
          SELECT COUNT(*)::NUMERIC
          FROM bk b
          WHERE EXISTS (SELECT 1 FROM session s WHERE s.booking_id = b.id)
        ) / (SELECT COUNT(*)::NUMERIC FROM bk),
        2
      )
    END,
    (SELECT COUNT(*)::BIGINT FROM sess),
    (SELECT COUNT(*)::BIGINT FROM sess WHERE booking_id IS NOT NULL),
    CASE
      WHEN (SELECT COUNT(*) FROM sess) = 0 THEN NULL
      ELSE ROUND(
        100.0 * (SELECT COUNT(*)::NUMERIC FROM sess WHERE booking_id IS NOT NULL)
        / (SELECT COUNT(*)::NUMERIC FROM sess),
        2
      )
    END;
$$;
