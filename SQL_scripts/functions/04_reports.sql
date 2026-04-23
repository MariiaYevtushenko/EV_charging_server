
-- -----------------------------------------------------------------------------
-- GetStationReportForPeriod — підсумки по станції за [p_date_from, p_date_to)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetStationReportForPeriod(
  p_station_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_sessions BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(s.id)::BIGINT AS total_sessions,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh_consumed,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue_amount
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.station_id = p_station_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to;
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- GetStationHourlyReport — погодинна агрегація для графіків
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetStationHourlyReport(
  p_station_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  hour TIMESTAMP,
  sessions_count BIGINT,
  total_kwh_consumed NUMERIC,
  total_revenue_amount NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc('hour', s.start_time) AS hour,
    COUNT(s.id)::BIGINT AS sessions_count,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh_consumed,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue_amount
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.station_id = p_station_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY date_trunc('hour', s.start_time)
  ORDER BY hour ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- GetAdminPeriodicReport — глобальна аналітика по днях (сесії з bill)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetAdminPeriodicReport(p_interval INTERVAL)
RETURNS TABLE(
  period_start TIMESTAMP,
  total_rev DECIMAL,
  total_energy DECIMAL,
  unique_users BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc('day', s.start_time) AS p_start,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue_amount,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh_consumed,
    COALESCE(COUNT(DISTINCT s.user_id), 0) AS unique_users_count
  FROM session s
  JOIN bill b ON s.id = b.session_id
  WHERE s.start_time >= now() - p_interval
  GROUP BY date_trunc('day', s.start_time)
  ORDER BY 1 DESC;
END;
$$ LANGUAGE plpgsql STABLE;


-- -----------------------------------------------------------------------------
-- GetVehicleReportForPeriod — підсумки по авто за [p_date_from, p_date_to)
-- Лише завершені сесії (COMPLETED) з успішною оплатою (bill.payment_status = SUCCESS).
-- start_time сесії в межах періоду; kWh та сума з bill.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetVehicleReportForPeriod(
  p_vehicle_id INT,
  p_date_from TIMESTAMP,
  p_date_to TIMESTAMP
)
RETURNS TABLE(
  total_sessions BIGINT,
  total_kwh NUMERIC,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(s.id)::BIGINT AS total_sessions,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh_consumed,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue_amount
  FROM session s
  INNER JOIN bill b ON b.session_id = s.id
  WHERE s.vehicle_id = p_vehicle_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
    AND s.status = 'COMPLETED'::session_status
    AND b.payment_status = 'SUCCESS'::payment_status;
END;
$$ LANGUAGE plpgsql STABLE;

-- Детальна аналітика для USER (період, графіки, броні, авто, ТОП станцій): див. User_analytics.sql
