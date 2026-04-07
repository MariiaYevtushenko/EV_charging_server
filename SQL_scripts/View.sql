-- =============================================================================
-- ПРЕДСТАВЛЕННЯ (VIEW) — аналітика, дашборди, операційні зрізи
-- Залежності: таблиці після DDL; бажано після functions/ та наявності даних у session/bill.
-- Примітка: графік «по годинах» у UI зручніше брати з GetStationHourlyReport (functions/04_reports.sql).
-- =============================================================================

-- Для STATION_ADMIN + ADMIN: завантаженість та дохід по кожному порту за останні 30 днів
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


-- Порівняльна статистика користувача (тиждень / попередній тиждень / енергія з початку місяця)
-- session LEFT JOIN bill: гроші лише з рахунків, kWh з усіх сесій (у т.ч. без bill)
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


-- Статистика по кожному авто користувача
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


-- Топ станцій на користувача (до 10): останні 90 днів; ранг по енергії, візитах, сумі
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


-- Глобальний дашборд: поточні 30 днів vs попередні 30 днів
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


-- Міста: частка робочих станцій (за кількістю станцій, не за рядками сесій), виручка, інтенсивність
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


-- Сегментація користувачів для адміна
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


-- Операційні зрізи (моніторинг)
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
