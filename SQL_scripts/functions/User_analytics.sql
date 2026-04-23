-- ВСЕ ОК
-- -----------------------------------------------------------------------------
-- Зведення по сесіях: енергія, витрати, середні, найчастіша станція
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetUserSessionEnergySpendSummary(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_sessions BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_kwh_per_session NUMERIC,
  avg_revenue_per_session NUMERIC,
  avg_session_duration_minutes NUMERIC,
  top_station_id INT,
  top_station_name TEXT,
  top_station_visit_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH sess AS (
    SELECT
      s.id,
      s.station_id,
      s.kwh_consumed,
      s.start_time,
      s.end_time,
      b.calculated_amount
    FROM session s
    LEFT JOIN bill b ON b.session_id = s.id
    WHERE s.user_id = p_user_id
      AND s.start_time >= p_date_from
      AND s.start_time < p_date_to
  ),
  top_st AS (
    SELECT st.id AS sid, st.name AS sname, COUNT(*)::BIGINT AS vcnt
    FROM sess x
    JOIN station st ON st.id = x.station_id
    GROUP BY st.id, st.name
    ORDER BY COUNT(*) DESC, COALESCE(SUM(x.kwh_consumed), 0) DESC NULLS LAST, st.id
    LIMIT 1
  )
  SELECT
    COUNT(*)::BIGINT AS total_sessions,
    COALESCE(SUM(sess.kwh_consumed), 0) AS total_kwh,
    COALESCE(SUM(sess.calculated_amount), 0) AS total_revenue,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE ROUND(COALESCE(SUM(sess.kwh_consumed), 0) / COUNT(*)::numeric, 6)
    END AS avg_kwh_per_session,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE ROUND(COALESCE(SUM(sess.calculated_amount), 0) / COUNT(*)::numeric, 2)
    END AS avg_revenue_per_session,
    ROUND(
      AVG(
        EXTRACT(EPOCH FROM (sess.end_time - sess.start_time)) / 60.0
      ) FILTER (WHERE sess.end_time IS NOT NULL),
      2
    ) AS avg_session_duration_minutes,
    (SELECT sid FROM top_st) AS top_station_id,
    (SELECT sname FROM top_st) AS top_station_name,
    (SELECT vcnt FROM top_st) AS top_station_visit_count
  FROM sess;
END;
$$ LANGUAGE plpgsql STABLE;


-- ВСЕ ОК
-- -----------------------------------------------------------------------------
-- Графік споживання / витрат по днях
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetUserEnergySpendByDay(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  day_bucket DATE,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (date_trunc('day', s.start_time))::DATE AS day_bucket,
    COUNT(s.id)::BIGINT AS session_count,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.user_id = p_user_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY date_trunc('day', s.start_time)
  ORDER BY day_bucket ASC;
END;
$$ LANGUAGE plpgsql STABLE;


-- -----------------------------------------------------------------------------
-- Графік по місяцях (усередині вказаного інтервалу)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetUserEnergySpendByMonth(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  month_start TIMESTAMP,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc('month', s.start_time) AS month_start,
    COUNT(s.id)::BIGINT AS session_count,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.user_id = p_user_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY date_trunc('month', s.start_time)
  ORDER BY month_start ASC;
END;
$$ LANGUAGE plpgsql STABLE;


-- -----------------------------------------------------------------------------
-- Бронювання за період: кількості та % «завершених» (COMPLETED)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetUserBookingStatsForPeriod(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_bookings BIGINT,
  cnt_booked BIGINT,
  cnt_completed BIGINT,
  cnt_missed BIGINT,
  cnt_cancelled BIGINT,
  pct_completed NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_bookings,
    COUNT(*) FILTER (WHERE b.status = 'BOOKED'::booking_status)::BIGINT AS cnt_booked,
    COUNT(*) FILTER (WHERE b.status = 'COMPLETED'::booking_status)::BIGINT AS cnt_completed,
    COUNT(*) FILTER (WHERE b.status = 'MISSED'::booking_status)::BIGINT AS cnt_missed,
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED'::booking_status)::BIGINT AS cnt_cancelled,
    CASE
      WHEN COUNT(*) = 0 THEN NULL
      ELSE ROUND(
        100.0 * COUNT(*) FILTER (WHERE b.status = 'COMPLETED'::booking_status)::numeric
        / COUNT(*)::numeric,
        2
      )
    END AS pct_completed
  FROM booking b
  WHERE b.user_id = p_user_id
    AND b.start_time >= p_date_from
    AND b.start_time < p_date_to;
END;
$$ LANGUAGE plpgsql STABLE;


-- -----------------------------------------------------------------------------
-- По кожному авто користувача: сесії, kWh, сума bill за період
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetUserVehicleEnergySpendForPeriod(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  vehicle_id INT,
  license_plate TEXT,
  brand TEXT,
  model TEXT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id AS vehicle_id,
    v.license_plate::TEXT,
    v.brand::TEXT,
    v.model::TEXT,
    COUNT(s.id)::BIGINT AS session_count,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue
  FROM vehicle v
  LEFT JOIN session s
    ON s.vehicle_id = v.id
   AND s.user_id = p_user_id
   AND s.start_time >= p_date_from
   AND s.start_time < p_date_to
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE v.user_id = p_user_id
  GROUP BY v.id, v.license_plate, v.brand, v.model
  ORDER BY COALESCE(SUM(s.kwh_consumed), 0) DESC NULLS LAST, v.id;
END;
$$ LANGUAGE plpgsql STABLE;


-- -----------------------------------------------------------------------------
-- ТОП-N станцій за спожитою енергією (kWh) за період
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetUserTopStationsByEnergy(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  rank BIGINT,
  station_id INT,
  station_name TEXT,
  session_count BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
DECLARE
  lim INT := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
BEGIN
  RETURN QUERY
  WITH agg AS (
    SELECT
      st.id AS sid,
      st.name::TEXT AS sname,
      COUNT(s.id)::BIGINT AS scnt,
      COALESCE(SUM(s.kwh_consumed), 0) AS kwh,
      COALESCE(SUM(b.calculated_amount), 0) AS rev
    FROM session s
    JOIN station st ON st.id = s.station_id
    LEFT JOIN bill b ON b.session_id = s.id
    WHERE s.user_id = p_user_id
      AND s.start_time >= p_date_from
      AND s.start_time < p_date_to
    GROUP BY st.id, st.name
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY agg.kwh DESC NULLS LAST, agg.scnt DESC, agg.sid)::BIGINT AS rank,
    agg.sid AS station_id,
    agg.sname AS station_name,
    agg.scnt AS session_count,
    agg.kwh AS total_kwh,
    agg.rev AS total_revenue
  FROM agg
  ORDER BY agg.kwh DESC NULLS LAST, agg.scnt DESC, agg.sid
  LIMIT lim;
END;
$$ LANGUAGE plpgsql STABLE;
