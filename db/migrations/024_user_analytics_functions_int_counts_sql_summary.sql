-- 42804 «structure of query does not match function result type»:
-- 1) COUNT(*) / COUNT(id) у PG — bigint, у RETURNS TABLE часто INT без явного ::INT.
-- 2) GetUserSessionEnergySpendSummary у plpgsql: імена стовпців RETURNS TABLE збігаються з OUT-змінними
--    і можуть ламати вивід RETURN QUERY — переведено на LANGUAGE sql.

CREATE OR REPLACE FUNCTION getusersessionenergyspendsummary(
  p_user_id integer,
  p_date_from timestamp without time zone,
  p_date_to timestamp without time zone
)
RETURNS TABLE(
  total_sessions integer,
  total_kwh numeric,
  total_revenue numeric,
  avg_kwh_per_session numeric,
  avg_revenue_per_session numeric,
  avg_session_duration_minutes numeric,
  top_station_id integer,
  top_station_name text,
  top_station_visit_count integer
)
LANGUAGE sql
STABLE
AS $BODY$
  WITH sess AS (
    SELECT
      s.id,
      s.station_id,
      s.kwh_consumed,
      s.start_time,
      s.end_time,
      s.status AS session_status,
      b.calculated_amount
    FROM session s
    LEFT JOIN bill b ON b.session_id = s.id
    WHERE s.user_id = p_user_id
      AND s.start_time >= p_date_from
      AND s.start_time < p_date_to
  ),
  top_st AS (
    SELECT st.id AS sid, st.name::text AS sname, count(*)::bigint AS vcnt
    FROM sess x
    INNER JOIN station st ON st.id = x.station_id
    GROUP BY st.id, st.name
    ORDER BY count(*) DESC, coalesce(sum(x.kwh_consumed), 0::numeric) DESC NULLS LAST, st.id
    LIMIT 1
  ),
  agg AS (
    SELECT
      count(*)::integer AS total_sessions,
      coalesce(sum(sess.kwh_consumed), 0)::numeric AS total_kwh,
      coalesce(sum(sess.calculated_amount), 0::numeric)::numeric AS total_revenue,
      CASE
        WHEN count(*) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status) = 0 THEN NULL::numeric
        ELSE round(
          (sum(sess.kwh_consumed) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status))::numeric
            / nullif(count(*) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status), 0),
          6
        )
      END AS avg_kwh_per_session,
      CASE
        WHEN count(*) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status) = 0 THEN NULL::numeric
        ELSE round(
          (sum(sess.calculated_amount) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status))::numeric
            / nullif(count(*) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status), 0),
          2
        )
      END AS avg_revenue_per_session,
      round(
        avg(
          extract(epoch FROM (sess.end_time - sess.start_time)) / 60.0
        ) FILTER (WHERE sess.end_time IS NOT NULL),
        2
      )::numeric AS avg_session_duration_minutes
    FROM sess
  )
  SELECT
    a.total_sessions,
    a.total_kwh,
    a.total_revenue,
    a.avg_kwh_per_session,
    a.avg_revenue_per_session,
    a.avg_session_duration_minutes,
    (SELECT ts.sid::integer FROM top_st ts LIMIT 1),
    (SELECT ts.sname FROM top_st ts LIMIT 1),
    (SELECT ts.vcnt::integer FROM top_st ts LIMIT 1)
  FROM agg a;
$BODY$;


CREATE OR REPLACE FUNCTION GetUserEnergySpendByDay(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  day_bucket DATE,
  session_count INT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (date_trunc('day', s.start_time))::DATE AS day_bucket,
    COUNT(s.id)::INT AS session_count,
    COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.user_id = p_user_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY date_trunc('day', s.start_time)
  ORDER BY day_bucket ASC;
END;
$$ LANGUAGE plpgsql STABLE;


CREATE OR REPLACE FUNCTION GetUserEnergySpendByMonth(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  month_start TIMESTAMP,
  session_count INT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc('month', s.start_time) AS month_start,
    COUNT(s.id)::INT AS session_count,
    COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.user_id = p_user_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY date_trunc('month', s.start_time)
  ORDER BY month_start ASC;
END;
$$ LANGUAGE plpgsql STABLE;


CREATE OR REPLACE FUNCTION GetUserBookingStatsForPeriod(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_bookings INT,
  cnt_booked INT,
  cnt_completed INT,
  cnt_missed INT,
  cnt_cancelled INT,
  pct_completed NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INT AS total_bookings,
    COUNT(*) FILTER (WHERE b.status = 'BOOKED'::booking_status)::INT AS cnt_booked,
    COUNT(*) FILTER (WHERE b.status = 'COMPLETED'::booking_status)::INT AS cnt_completed,
    COUNT(*) FILTER (WHERE b.status = 'MISSED'::booking_status)::INT AS cnt_missed,
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED'::booking_status)::INT AS cnt_cancelled,
    CASE
      WHEN COUNT(*) = 0 THEN NULL::NUMERIC
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
  session_count INT,
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
    COUNT(s.id)::INT AS session_count,
    COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
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


CREATE OR REPLACE FUNCTION GetUserTopStationsByEnergy(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  station_id INT,
  station_name TEXT,
  session_count INT,
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
      COUNT(s.id)::INT AS scnt,
      COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS kwh,
      COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS rev
    FROM session s
    JOIN station st ON st.id = s.station_id
    LEFT JOIN bill b ON b.session_id = s.id
    WHERE s.user_id = p_user_id
      AND s.start_time >= p_date_from
      AND s.start_time < p_date_to
    GROUP BY st.id, st.name
  )
  SELECT
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


CREATE OR REPLACE FUNCTION GetVehicleReportForPeriod(
  p_vehicle_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_sessions INT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(s.id)::INT AS total_sessions,
    COALESCE(SUM(s.kwh_consumed), 0)::NUMERIC AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0)::NUMERIC AS total_revenue
  FROM session s
  INNER JOIN bill b ON b.session_id = s.id
  WHERE s.vehicle_id = p_vehicle_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
    AND s.status = 'COMPLETED'::session_status
    AND b.payment_status = 'SUCCESS'::payment_status;
END;
$$ LANGUAGE plpgsql STABLE;
