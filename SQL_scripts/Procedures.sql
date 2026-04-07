-- =============================================================================
-- PROCEDURES + мутаційні функції (INSERT / UPDATE у БД)
-- Розрахунок суми залишено у functions/02_session_billing.sql (GetFinalSessionAmount).
--
-- Порядок деплою після DDL:
--   1) functions/01_tariff.sql
--   2) functions/02_session_billing.sql
--   3) functions/03_booking_slots.sql
--   4) functions/04_reports.sql
--   5) Procedures.sql (цей файл)
--   6) Triggers.sql, Indexes.sql, View.sql — за потреби
-- =============================================================================

-- -----------------------------------------------------------------------------
-- UpsertBillForSession — INSERT / ON CONFLICT bill
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION UpsertBillForSession(
  p_session_id INT,
  p_payment_method payment_method,
  p_payment_status payment_status
)
RETURNS VOID AS $$
DECLARE
  v_final_price DECIMAL(10, 2);
  v_tariff_price DECIMAL(10, 2);
BEGIN
  SELECT calculated_amount, price_per_kwh_at_time
  INTO v_final_price, v_tariff_price
  FROM GetFinalSessionAmount(p_session_id);

  INSERT INTO bill (session_id, calculated_amount, price_per_kwh_at_time, payment_method, payment_status)
  VALUES (p_session_id, v_final_price, v_tariff_price, p_payment_method, p_payment_status)
  ON CONFLICT (session_id) DO UPDATE SET
    calculated_amount = EXCLUDED.calculated_amount,
    price_per_kwh_at_time = EXCLUDED.price_per_kwh_at_time,
    payment_method = EXCLUDED.payment_method,
    payment_status = EXCLUDED.payment_status;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- CreateFinalBill — процедура для CALL з тригера / API
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE CreateFinalBill(
  p_session_id INT,
  p_payment_method payment_method,
  p_payment_status payment_status
)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM UpsertBillForSession(p_session_id, p_payment_method, p_payment_status);
END;
$$;

-- -----------------------------------------------------------------------------
-- StartSession — INSERT session (ACTIVE)
-- -----------------------------------------------------------------------------
-- Перевірки: немає іншої ACTIVE на порту; станція WORK; порт не REPAIRED;
-- без бронювання — порт FREE; з бронюванням — відповідність booking (BOOKED/PAID).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION StartSession(
  p_user_id INT,
  p_vehicle_id INT,
  p_station_id INT,
  p_port_number INT,
  p_booking_id INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_new_id INT;
  v_b_user INT;
  v_b_vehicle INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM session s
    WHERE s.station_id = p_station_id
      AND s.port_number = p_port_number
      AND s.status = 'ACTIVE'::session_status
  ) THEN
    RAISE EXCEPTION 'На цьому порту вже є активна сесія зарядки';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM station WHERE id = p_station_id AND status = 'WORK'::station_status
  ) THEN
    RAISE EXCEPTION 'Станція наразі не працює або в архіві';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM port
    WHERE station_id = p_station_id
      AND port_number = p_port_number
      AND status <> 'REPAIRED'::port_status
  ) THEN
    RAISE EXCEPTION 'Порт не знайдено або на ремонті';
  END IF;

  IF p_booking_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM port
      WHERE station_id = p_station_id
        AND port_number = p_port_number
        AND status = 'FREE'::port_status
    ) THEN
      RAISE EXCEPTION 'Порт недоступний для старту без бронювання (очікується статус FREE)';
    END IF;
  ELSE
    SELECT b.user_id, b.vehicle_id
    INTO v_b_user, v_b_vehicle
    FROM booking b
    WHERE b.id = p_booking_id
      AND b.station_id = p_station_id
      AND b.port_number = p_port_number
      AND b.status IN ('BOOKED'::booking_status, 'PAID'::booking_status);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Бронювання не знайдено, не відповідає порту або недійсне';
    END IF;

    IF v_b_user IS NOT NULL AND p_user_id IS NOT NULL AND v_b_user IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Бронювання належить іншому користувачу';
    END IF;

    IF v_b_vehicle IS NOT NULL AND p_vehicle_id IS NOT NULL AND v_b_vehicle IS DISTINCT FROM p_vehicle_id THEN
      RAISE EXCEPTION 'Бронювання прив''язане до іншого авто';
    END IF;
  END IF;

  INSERT INTO session (
    user_id,
    vehicle_id,
    station_id,
    port_number,
    booking_id,
    start_time,
    kwh_consumed,
    status
  )
  VALUES (
    p_user_id,
    p_vehicle_id,
    p_station_id,
    p_port_number,
    p_booking_id,
    CURRENT_TIMESTAMP,
    0,
    'ACTIVE'::session_status
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- CancelBooking — UPDATE booking → CANCELLED
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE CancelBooking(p_booking_id INT)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE booking
  SET status = 'CANCELLED'
  WHERE id = p_booking_id AND status = 'BOOKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Бронювання не знайдено або вже не в статусі BOOKED';
  END IF;
END;
$$;
