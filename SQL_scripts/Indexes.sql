-- =============================================================================
-- ІНДЕКСИ (5 шт.) — обґрунтування від типових сценаріїв UI та REST API
--
-- 1–3: кабінет кінцевого користувача — списки з фільтром WHERE user_id
--      (Prisma: userRepository — бронювання, сесії/оплати, авто).
-- 4:    форма бронювання (станція + порт + інтервал часу) — підзапити на перетин
--      слотів і тригер CheckBookingOverlap звертаються до booking за парою
--      (station_id, port_number) серед активних бронювань BOOKED.
-- 5:    адмін-інтерфейс станції / аналітика за період — функції GetStationReportForPeriod,
--      GetStationHourlyReport (фільтр по station_id та start_time).
-- =============================================================================

-- ІНДЕКСИ
-- ??
CREATE INDEX IF NOT EXISTS index_BookingTime ON booking (start_time, end_time);-- Кабінет: «Мої бронювання» → GET .../bookings (findMany WHERE user_id)

-- Кабінет: «Мої бронювання» → GET .../bookings (findMany WHERE user_id)
CREATE INDEX IF NOT EXISTS idx_booking_user_id ON booking (user_id);

-- Кабінет: історія зарядок → GET .../sessions; оплати йдуть через session.user_id
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session (user_id);

-- Кабінет: гараж авто → GET .../vehicles (findMany WHERE user_id)
CREATE INDEX IF NOT EXISTS idx_vehicle_user_id ON vehicle (user_id);

-- Бронювання: доступність слоту / перевірка перетину по порту (лише не скасовані)
CREATE INDEX IF NOT EXISTS idx_booking_station_port_booked
  ON booking (station_id, port_number)
  WHERE status = 'BOOKED'::booking_status;
