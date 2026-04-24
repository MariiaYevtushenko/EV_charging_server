-- Виправлення 42804: типи рядка RETURN QUERY мають збігатися з RETURNS TABLE (bigint COUNT(*) → INT тощо).
CREATE OR REPLACE FUNCTION GetUserSessionEnergySpendSummary(
  p_user_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_sessions INT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_kwh_per_session NUMERIC,
  avg_revenue_per_session NUMERIC,
  avg_session_duration_minutes NUMERIC,
  top_station_id INT,
  top_station_name TEXT,
  top_station_visit_count INT
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
      AND s.status = 'COMPLETED'::session_status
  ),
  top_st AS (
    SELECT st.id AS sid, st.name AS sname, COUNT(*) AS vcnt
    FROM sess x
    JOIN station st ON st.id = x.station_id
    GROUP BY st.id, st.name
    ORDER BY COUNT(*) DESC, COALESCE(SUM(x.kwh_consumed), 0) DESC NULLS LAST, st.id
    LIMIT 1
  )
  SELECT
    COUNT(*)::INT AS total_sessions,
    COALESCE(SUM(sess.kwh_consumed), 0)::NUMERIC AS total_kwh,
    COALESCE(SUM(sess.calculated_amount), 0)::NUMERIC AS total_revenue,
    CASE WHEN COUNT(*) = 0 THEN NULL::NUMERIC
         ELSE ROUND(COALESCE(SUM(sess.kwh_consumed), 0) / COUNT(*)::numeric, 6)
    END AS avg_kwh_per_session,
    CASE WHEN COUNT(*) = 0 THEN NULL::NUMERIC
         ELSE ROUND(COALESCE(SUM(sess.calculated_amount), 0) / COUNT(*)::numeric, 2)
    END AS avg_revenue_per_session,
    ROUND(
      AVG(
        EXTRACT(EPOCH FROM (sess.end_time - sess.start_time)) / 60.0
      ) FILTER (WHERE sess.end_time IS NOT NULL),
      2
    )::NUMERIC AS avg_session_duration_minutes,
    (SELECT sid::INT FROM top_st) AS top_station_id,
    (SELECT sname::TEXT FROM top_st) AS top_station_name,
    (SELECT vcnt::INT FROM top_st) AS top_station_visit_count
  FROM sess;
END;
$$ LANGUAGE plpgsql STABLE;
