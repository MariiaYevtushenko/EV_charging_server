
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
  session_count INT,
  total_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.total_sessions AS session_count,
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
  session_count INT,
  booking_count INT,
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
      COUNT(bk.id) AS booking_count
    FROM booking bk
    WHERE bk.start_time >= p_date_from
      AND bk.start_time < p_date_to
    GROUP BY 1
  )
  SELECT
    d.bucket_date,
    COALESCE(s.session_count, 0),
    COALESCE(b.booking_count, 0),
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
  session_count INT,
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






-- ========================================================================================
-- АДМІНІСТРАТОР СТАНЦІЙ
-- ========================================================================================


-- ТОП станцій за кількістю сесій у періоді
CREATE OR REPLACE FUNCTION GetNetworkStationsMostSessions(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(station_id INT, station_name TEXT, session_count INT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    st.id AS station_id,
    st.name::TEXT AS station_name,
    COUNT(s.id) AS session_count
  FROM station st
  LEFT JOIN session s
    ON s.station_id = st.id
   AND s.start_time >= p_date_from
   AND s.start_time < p_date_to
  GROUP BY st.id, st.name
  ORDER BY COUNT(s.id) DESC NULLS LAST, st.id
  LIMIT (SELECT LEAST(50, GREATEST(1, COALESCE(p_limit, 10)))::INT);
$$;


-- Пікові години однієї станції (для деталізації stationId у snapshot)
CREATE OR REPLACE FUNCTION GetStationPeakHourBuckets(
  p_station_id INT,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(iso_dow INT, hour_of_day INT, session_count INT)
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


-- Підсумки сесій однієї станції за період
CREATE OR REPLACE FUNCTION GetStationSessionStatsForPeriod(
  p_station_id INT,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  total_sessions INT,
  avg_duration_minutes NUMERIC,
  avg_kwh NUMERIC,
  total_revenue NUMERIC,
  avg_bill_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(s.id) AS total_sessions,
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


-- Погодинна агрегація по одній станції за період — для графіків.
CREATE OR REPLACE FUNCTION GetStationHourlyReport(
  p_station_id INT,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  hour TIMESTAMPTZ,
  sessions_count INT,
  total_kwh_consumed NUMERIC,
  total_revenue_amount NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    date_trunc('hour', s.start_time) AS hour,
    COUNT(s.id) AS sessions_count,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh_consumed,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue_amount
  FROM session s
  LEFT JOIN bill b ON b.session_id = s.id
  WHERE s.station_id = p_station_id
    AND s.start_time >= p_date_from
    AND s.start_time < p_date_to
  GROUP BY 1
  ORDER BY 1 ASC;
$$;


-- Мережа: KPI бронювань за період
CREATE OR REPLACE FUNCTION GetNetworkBookingStatsForPeriod(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  total_bookings INT,
  booked_count INT,
  cancelled_count INT,
  completed_count INT,
  missed_count INT,
  calc_bookings INT,
  deposit_bookings INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE b.status = 'BOOKED'::booking_status),
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED'::booking_status),
    COUNT(*) FILTER (WHERE b.status = 'COMPLETED'::booking_status),
    COUNT(*) FILTER (WHERE b.status = 'MISSED'::booking_status),
    COUNT(*) FILTER (WHERE b.booking_type = 'CALC'::booking_type),
    COUNT(*) FILTER (WHERE b.booking_type = 'DEPOSIT'::booking_type)
  FROM booking b
  WHERE b.start_time >= p_date_from
    AND b.start_time < p_date_to;
$$;


-- Одна станція: ті ж лічильники бронювань за період.
CREATE OR REPLACE FUNCTION GetStationBookingStatsForPeriod(
  p_station_id INT,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  total_bookings INT,
  booked_count INT,
  cancelled_count INT,
  completed_count INT,
  missed_count INT,
  calc_bookings INT,
  deposit_bookings INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE b.status = 'BOOKED'::booking_status),
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED'::booking_status),
    COUNT(*) FILTER (WHERE b.status = 'COMPLETED'::booking_status),
    COUNT(*) FILTER (WHERE b.status = 'MISSED'::booking_status),
    COUNT(*) FILTER (WHERE b.booking_type = 'CALC'::booking_type),
    COUNT(*) FILTER (WHERE b.booking_type = 'DEPOSIT'::booking_type)
  FROM booking b
  WHERE b.station_id = p_station_id
    AND b.start_time >= p_date_from
    AND b.start_time < p_date_to;
$$;


-- Проксі завантаження: сума годин зарядних сесій / (порти × години вікна), %.
CREATE OR REPLACE FUNCTION GetStationUtilizationProxyForPeriod(
  p_station_id INT,
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  port_count INT,  window_hours NUMERIC,
  charging_hours NUMERIC,
  utilization_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH pc AS (
    SELECT COUNT(*) AS c
    FROM port p
    WHERE p.station_id = p_station_id
  ),
  wh AS (
    SELECT GREATEST(
      EXTRACT(EPOCH FROM (p_date_to - p_date_from)) / 3600.0,
      0.0001
    )::NUMERIC AS h
  ),
  ch AS (
    SELECT
      COALESCE(
        SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0)
        FILTER (WHERE s.end_time IS NOT NULL),
        0
      )::NUMERIC AS charging_h
    FROM session s
    WHERE s.station_id = p_station_id
      AND s.start_time >= p_date_from
      AND s.start_time < p_date_to
  ),
  denom AS (
    SELECT (SELECT c FROM pc) * (SELECT h FROM wh) AS d
    FROM pc, wh
  )
  SELECT
    (SELECT c FROM pc),
    (SELECT h FROM wh),
    (SELECT charging_h FROM ch),
    ROUND(
      100.0 * (SELECT charging_h FROM ch) / NULLIF((SELECT d FROM denom), 0),
      2
    )
  FROM pc, wh, ch, denom;
$$;


-- Уся мережа: поточний календарний місяць (з 1-го до кінця «сьогодні») vs повний попередній місяць.
CREATE OR REPLACE FUNCTION GetStationAdminMonthComparison()
RETURNS TABLE(
  current_month_sessions INT,
  previous_month_sessions INT,
  current_month_revenue NUMERIC,
  previous_month_revenue NUMERIC,
  current_month_bookings INT,
  previous_month_bookings INT,
  sessions_delta_pct NUMERIC,
  revenue_delta_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH b AS (
    SELECT
      date_trunc('month', now()) AS cur_month_start,
      date_trunc('day', now()) + interval '1 day' AS cur_end,
      date_trunc('month', now()) - interval '1 month' AS prev_month_start,
      date_trunc('month', now()) AS prev_month_end
  ),
  cur_sess AS (
    SELECT
      COUNT(s.id) AS sessions,
      COALESCE(SUM(bl.calculated_amount), 0)::NUMERIC AS revenue
    FROM session s
    LEFT JOIN bill bl ON bl.session_id = s.id
    CROSS JOIN b
    WHERE s.start_time >= b.cur_month_start
      AND s.start_time < b.cur_end
  ),
  prev_sess AS (
    SELECT
      COUNT(s.id) AS sessions,
      COALESCE(SUM(bl.calculated_amount), 0) AS revenue
    FROM session s
    LEFT JOIN bill bl ON bl.session_id = s.id
    CROSS JOIN b
    WHERE s.start_time >= b.prev_month_start
      AND s.start_time < b.prev_month_end
  ),
  cur_book AS (
    SELECT COUNT(*) AS c
    FROM booking bk
    CROSS JOIN b
    WHERE bk.start_time >= b.cur_month_start
      AND bk.start_time < b.cur_end
  ),
  prev_book AS (
    SELECT COUNT(*) AS c
    FROM booking bk
    CROSS JOIN b
    WHERE bk.start_time >= b.prev_month_start
      AND bk.start_time < b.prev_month_end
  )
  SELECT
    c.sessions,
    p.sessions,
    c.revenue,
    p.revenue,
    cb.c,
    pb.c,
    ROUND(100.0 * (c.sessions - p.sessions) / NULLIF(p.sessions, 0)::NUMERIC, 2),
    ROUND(100.0 * (c.revenue - p.revenue) / NULLIF(p.revenue, 0), 2)
  FROM cur_sess c
  CROSS JOIN prev_sess p
  CROSS JOIN cur_book cb
  CROSS JOIN prev_book pb;
$$;


-- ============================================================================
-- Користувач
-- ============================================================================
-- Зведення по сесіях за [p_date_from, p_date_to) по start_time — **усі** сесії користувача (як графік по днях).
-- Середні kWh / чек — лише по завершених (COMPLETED), щоб не ділити на активні з 0 kWh.
-- LANGUAGE sql: уникнення 42804 через OUT-змінні plpgsql з тими ж іменами, що й стовпці RETURNS TABLE.
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
)
LANGUAGE sql
STABLE
AS $$
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
    SELECT st.id AS sid, st.name::TEXT AS sname, count(*)::bigint AS vcnt
    FROM sess x
    INNER JOIN station st ON st.id = x.station_id
    GROUP BY st.id, st.name
    ORDER BY count(*) DESC, coalesce(sum(x.kwh_consumed), 0::numeric) DESC NULLS LAST, st.id
    LIMIT 1
  ),
  agg AS (
    SELECT
      count(*)::INT AS total_sessions,
      coalesce(sum(sess.kwh_consumed), 0)::NUMERIC AS total_kwh,
      coalesce(sum(sess.calculated_amount), 0::numeric)::NUMERIC AS total_revenue,
      CASE
        WHEN count(*) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status) = 0 THEN NULL::NUMERIC
        ELSE round(
          (sum(sess.kwh_consumed) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status))::numeric
            / nullif(count(*) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status), 0),
          6
        )
      END AS avg_kwh_per_session,
      CASE
        WHEN count(*) FILTER (WHERE sess.session_status = 'COMPLETED'::session_status) = 0 THEN NULL::NUMERIC
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
      )::NUMERIC AS avg_session_duration_minutes
    FROM sess
  )
  SELECT
    a.total_sessions,
    a.total_kwh,
    a.total_revenue,
    a.avg_kwh_per_session,
    a.avg_revenue_per_session,
    a.avg_session_duration_minutes,
    (SELECT ts.sid::INT FROM top_st ts LIMIT 1),
    (SELECT ts.sname FROM top_st ts LIMIT 1),
    (SELECT ts.vcnt::INT FROM top_st ts LIMIT 1)
  FROM agg a;
$$;


-- Графік споживання / витрат по днях
-- -----------------------------------------------------------------------------
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


-- Графік по місяцях (усередині вказаного інтервалу)
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


-- Є ВСЕ ОК, ВИКОРИСТОВУЄТЬСЯ
-- Бронювання за період: кількості та % «завершених» (COMPLETED)
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


-- ВСЕ ОК, ВИКОРИСТОВУЄТЬСЯ
-- По кожному авто користувача: сесії, kWh, сума bill за період
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



-- ВСЕ ОК, ВИКОРИСТОВУЄТЬСЯ
-- Топ-N станцій за спожитою енергією (kWh) за період
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

-- Детальна аналітика для USER (період, графіки, броні, авто, ТОП станцій): див. User_analytics.sql


