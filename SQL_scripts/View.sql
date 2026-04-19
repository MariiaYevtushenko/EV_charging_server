
-- Станція: сесії та виручка по кожному порту, останні 30 днів.
CREATE OR REPLACE VIEW View_StationPerformance AS
SELECT
    s.id AS station_id,
    s.name AS station_name,
    p.port_number,
    COUNT(sess.id) AS total_sessions,
    COALESCE(SUM(sess.kwh_consumed), 0) AS total_energy,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue
FROM station s
JOIN port p ON s.id = p.station_id
LEFT JOIN session sess
  ON sess.station_id = p.station_id
 AND sess.port_number = p.port_number
 AND sess.start_time >= now() - interval '30 days'
LEFT JOIN bill b ON sess.id = b.session_id
GROUP BY s.id, s.name, p.port_number;


-- Користувач: суми з bill за поточний і попередній 7-денний відрізок; kWh з початку місяця (усі сесії).
CREATE OR REPLACE VIEW View_UserAnalyticsComparison AS
WITH lined AS (
    SELECT
        s.user_id,
        b.calculated_amount,
        s.kwh_consumed,
        date_trunc('day', s.start_time) AS day_bucket,
        s.start_time
    FROM session s
    LEFT JOIN bill b ON b.session_id = s.id
)
SELECT
    user_id,
    SUM(calculated_amount) FILTER (
        WHERE day_bucket > now() - interval '7 days'
    ) AS money_last_7d,
    SUM(calculated_amount) FILTER (
        WHERE day_bucket >= date_trunc('day', now() - interval '14 days')
          AND day_bucket < date_trunc('day', now() - interval '7 days')
    ) AS money_prev_7d,
    SUM(kwh_consumed) FILTER (
        WHERE start_time >= date_trunc('month', now())
    ) AS energy_this_month
FROM lined
GROUP BY user_id;


-- Користувач: агрегати по кожному авто (усі часи + кількість зарядок за 30 днів).
CREATE OR REPLACE VIEW View_UserVehicleStats AS
SELECT
    v.user_id,
    v.license_plate,
    v.brand || ' ' || v.model AS car_name,
    COUNT(s.id) AS total_charges,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
    COUNT(s.id) FILTER (
        WHERE s.start_time > now() - interval '30 days') AS charges_last_30d
FROM vehicle v
LEFT JOIN session s ON v.id = s.vehicle_id
GROUP BY v.user_id, v.id, v.license_plate, v.brand, v.model;


-- Користувач: до 10 улюблених станцій за 90 днів (ранг за kWh, візитами, сумою; лише сесії з bill).
CREATE OR REPLACE VIEW View_UserStationLoyalty AS
WITH users_charges AS (
    SELECT
        s.user_id,
        st.id AS station_id,
        st.name AS station_name,
        COUNT(s.id) AS visit_count,
        COALESCE(SUM(s.kwh_consumed), 0) AS total_energy,
        COALESCE(SUM(b.calculated_amount), 0) AS total_spent
    FROM session s
    JOIN station st ON s.station_id = st.id
    JOIN bill b ON s.id = b.session_id
    WHERE s.start_time >= now() - interval '90 days'
    GROUP BY s.user_id, st.id, st.name
),
ranked AS (
    SELECT
        users_charges.*,
        RANK() OVER (
            PARTITION BY user_id
            ORDER BY total_energy DESC, visit_count DESC, total_spent DESC, station_id
        ) AS preference_rank
    FROM users_charges
)
SELECT user_id, station_id, station_name, visit_count, total_energy, total_spent, preference_rank
FROM ranked
WHERE preference_rank <= 10;


-- Адмін: метрики останніх 30 днів і % зростання відносно попередніх 30 (лише сесії з bill).
CREATE OR REPLACE VIEW View_AdminGlobalDashboard AS
WITH stats_current AS (
    SELECT
        SUM(b.calculated_amount) AS rev,
        SUM(s.kwh_consumed) AS energy,
        COUNT(DISTINCT s.vehicle_id) AS cars,
        COUNT(s.id) AS sessions
    FROM bill b
    JOIN session s ON b.session_id = s.id
    WHERE s.start_time >= now() - interval '30 days'
),
stats_previous AS (
    SELECT
        SUM(b.calculated_amount) AS rev,
        SUM(s.kwh_consumed) AS energy,
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
    ROUND(((curr.rev - prev.rev) / NULLIF(prev.rev, 0)) * 100, 2) AS rev_growth_pct,
    ROUND(((curr.energy - prev.energy) / NULLIF(prev.energy, 0)) * 100, 2) AS energy_growth_pct,
    ROUND(((curr.cars - prev.cars) / NULLIF(prev.cars, 0)) * 100, 2) AS cars_growth_pct,
    ROUND(((curr.sessions - prev.sessions) / NULLIF(prev.sessions, 0)) * 100, 2) AS sessions_growth_pct
FROM stats_current curr
CROSS JOIN stats_previous prev;


-- Адмін: по місту — частка станцій WORK, виручка, середній чек, «інтенсивність» (сесії на станцію).
CREATE OR REPLACE VIEW view_admin_city_performance AS
SELECT
    l.city,
    COUNT(DISTINCT s.id) AS total_stations,
    ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN s.status = 'WORK' THEN s.id END)
        / NULLIF(COUNT(DISTINCT s.id), 0),
        2
    ) AS operational_rate_pct,
    COALESCE(SUM(b.calculated_amount), 0) AS total_revenue,
    ROUND(AVG(b.calculated_amount) FILTER (WHERE b.calculated_amount IS NOT NULL), 2) AS avg_bill_per_session,
    ROUND(COUNT(sess.id)::numeric / NULLIF(COUNT(DISTINCT s.id), 0), 2) AS intensity_index
FROM location l
JOIN station s ON l.id = s.location_id
LEFT JOIN session sess ON s.id = sess.station_id
LEFT JOIN bill b ON sess.id = b.session_id
GROUP BY l.city;


-- Адмін: користувачі з сегментом (VIP / Regular / New) і датою останньої сесії.
CREATE OR REPLACE VIEW view_admin_user_segments AS
SELECT
    u.id AS user_id,
    u.name || ' ' || u.surname AS full_name,
    COUNT(s.id) AS total_sessions,
    COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
    COALESCE(SUM(b.calculated_amount), 0) AS total_spent,
    CASE
        WHEN COUNT(s.id) > 20 THEN 'VIP (Loyal)'
        WHEN COUNT(s.id) BETWEEN 5 AND 20 THEN 'Regular'
        ELSE 'New/Occasional'
    END AS user_segment,
    MAX(s.start_time) AS last_session_date
FROM ev_user u
LEFT JOIN session s ON u.id = s.user_id
LEFT JOIN bill b ON s.id = b.session_id
GROUP BY u.id, u.name, u.surname;


-- Моніторинг: активні сесії зарядки.
CREATE OR REPLACE VIEW View_ActiveSessions AS
SELECT
    s.id AS session_id,
    s.user_id,
    s.station_id,
    s.port_number,
    s.vehicle_id,
    s.start_time,
    s.kwh_consumed,
    st.name AS station_name
FROM session s
JOIN station st ON st.id = s.station_id
WHERE s.status = 'ACTIVE';


-- Моніторинг: майбутні бронювання BOOKED (інтервал ще не закінчився).
CREATE OR REPLACE VIEW View_UpcomingBookings AS
SELECT
    b.id AS booking_id,
    b.user_id,
    b.station_id,
    b.port_number,
    b.start_time,
    b.end_time,
    b.booking_type,
    b.prepayment_amount,
    st.name AS station_name
FROM booking b
JOIN station st ON st.id = b.station_id
WHERE b.status = 'BOOKED'
  AND b.end_time > now();
