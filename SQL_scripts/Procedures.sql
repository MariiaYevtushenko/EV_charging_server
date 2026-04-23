-- ОСНОВНІ ПРОЦЕДУРИ
-- ============================================================================
-- Створення / оновлення рахунку для сесії (INSERT … ON CONFLICT).
-- Тригер SessionCompletedFinalizeBill після переходу ACTIVE → COMPLETED викликає CreateFinalBill і оновлює порт USED→FREE.
-- payment_method завжди NULL на цьому кроці (оплата — окремо, напр. ProcessPayment).
CREATE OR REPLACE PROCEDURE CreateFinalBill(
  p_session_id INT,
  p_payment_status payment_status
)
LANGUAGE plpgsql AS $$
DECLARE
  v_final_price DECIMAL(10, 2);
  v_tariff_price DECIMAL(10, 2);
BEGIN
  IF p_session_id IS NULL OR p_session_id <= 0 THEN
    RAISE EXCEPTION 'CreateFinalBill: некоректний p_session_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM session WHERE id = p_session_id) THEN
    RAISE EXCEPTION 'CreateFinalBill: сесії з id % не існує', p_session_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM session
    WHERE id = p_session_id AND status = 'COMPLETED'::session_status
  ) THEN
    RAISE EXCEPTION
      'CreateFinalBill: сесія % має бути в статусі COMPLETED (рахунок створюється після завершення зарядки)',
      p_session_id;
  END IF;

  SELECT calculated_amount, price_per_kwh
  INTO STRICT v_final_price, v_tariff_price
  FROM GetFinalSessionAmount(p_session_id);

  INSERT INTO bill (session_id, calculated_amount, price_per_kwh_at_time, payment_method, payment_status)
  VALUES (p_session_id, v_final_price, v_tariff_price, NULL, p_payment_status)
  ON CONFLICT (session_id) DO UPDATE SET
    calculated_amount = EXCLUDED.calculated_amount,
    price_per_kwh_at_time = EXCLUDED.price_per_kwh_at_time,
    payment_method = EXCLUDED.payment_method,
    payment_status = EXCLUDED.payment_status;
END;
$$;

--------------------------------------------------
-- Стара назва процедури завершення сесії (перейменовано на EndSession).
DROP PROCEDURE IF EXISTS stopsession(integer, numeric);

-- Завершення сесії (ACTIVE → COMPLETED) + фінальні кВт·год.
-- Після цього UPDATE спрацьовує тригер trigger_SessionCompletedFinalizeBill (Triggers.sql):
-- рахунок CreateFinalBill, порт USED→FREE. Дублювати цю логіку в другому тригері не потрібно.
-- Окремий тригер замість цієї процедури не підходить: kwh і id сесії мають прийти з виклику (API / SQL).
CREATE OR REPLACE PROCEDURE EndSession(
  p_session_id INT,
  p_final_kwh DECIMAL(10,3)
)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_session_id IS NULL OR p_session_id <= 0 THEN
    RAISE EXCEPTION 'EndSession: некоректний p_session_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM session WHERE id = p_session_id) THEN
    RAISE EXCEPTION 'EndSession: сесії з id % не існує', p_session_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM session
    WHERE id = p_session_id AND status = 'ACTIVE'::session_status
  ) THEN
    RAISE EXCEPTION
      'EndSession: сесія % не в статусі ACTIVE (вже завершена, скасована або не знайдена як активна)',
      p_session_id;
  END IF;

  IF p_final_kwh < 0 THEN
    RAISE EXCEPTION 'EndSession: kwh_consumed не може бути від''ємним (отримано %)', p_final_kwh;
  END IF;

  UPDATE session
  SET
    end_time = CURRENT_TIMESTAMP,
    kwh_consumed = p_final_kwh,
    status = 'COMPLETED'
  WHERE id = p_session_id
    AND status = 'ACTIVE'::session_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'EndSession: сесію % не оновлено (вона вже не ACTIVE — можливе паралельне завершення)',
      p_session_id;
  END IF;
END;
$$;

--------------------------------------------------------------------------
-- Оплата рахунку 
-- Зміна статусу рахунку на SUCCESS і оновлення дати оплати з методом оплати
-- якщо ще є бронювання то воно стає COMPLETED
CREATE OR REPLACE PROCEDURE ProcessPayment(
  p_bill_id INT,
  p_payment_method payment_method
)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_bill_id IS NULL OR p_bill_id <= 0 THEN
    RAISE EXCEPTION 'ProcessPayment: некоректний p_bill_id';
  END IF;

  UPDATE bill
  SET
    payment_status = 'SUCCESS',
    payment_method = p_payment_method,
    paid_at = CURRENT_TIMESTAMP
  WHERE id = p_bill_id
    AND payment_status = 'PENDING'::payment_status;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM bill WHERE id = p_bill_id) THEN
      RAISE EXCEPTION 'ProcessPayment: рахунок % вже оплачено або не в статусі PENDING', p_bill_id;
    ELSE
      RAISE EXCEPTION 'ProcessPayment: рахунок з id % не знайдено', p_bill_id;
    END IF;
  END IF;

  -- Завершити бронювання лише якщо сесію цього рахунку було створено з бронювання (session.booking_id IS NOT NULL).
  -- Якщо сесія без бронювання, рядків для оновлення не буде — це нормально.
  UPDATE booking b
  SET status = 'COMPLETED'
  FROM bill bl
  INNER JOIN session s ON s.id = bl.session_id AND s.booking_id IS NOT NULL
  WHERE bl.id = p_bill_id
    AND b.id = s.booking_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- Розпочати сесію зарядки (повертає id нової сесії — лише FUNCTION, не PROCEDURE).
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
  IF p_station_id IS NULL OR p_station_id <= 0 OR p_port_number IS NULL OR p_port_number <= 0 THEN
    RAISE EXCEPTION 'StartSession: некоректні p_station_id або p_port_number';
  END IF;

  -- Перевірка, чи на цьому порту вже є активна сесія зарядки
  IF EXISTS (
    SELECT 1 FROM session s
    WHERE s.station_id = p_station_id
      AND s.port_number = p_port_number
      AND s.status = 'ACTIVE'::session_status
  ) THEN
    RAISE EXCEPTION 'StartSession: на цьому порту вже є активна сесія зарядки';
  END IF;

  -- Перевірка, чи станція працює
  IF NOT EXISTS (
    SELECT 1
    FROM station
    WHERE id = p_station_id AND status = 'WORK'::station_status
  ) THEN
    RAISE EXCEPTION 'StartSession: станція наразі не працює або в архіві';
  END IF;

  -- Перевірка, чи порт доступний для старту
  IF NOT EXISTS (
    SELECT 1 FROM port
    WHERE station_id = p_station_id
      AND port_number = p_port_number
      AND status NOT IN ('REPAIRED'::port_status, 'NOT_WORKING'::port_status)
  ) THEN
    RAISE EXCEPTION 'StartSession: порт не знайдено або на ремонті';
  END IF;

  -- Перевірка, чи порт доступний для старту без бронювання
  IF p_booking_id IS NULL THEN

    IF NOT EXISTS (
      SELECT 1 FROM port
      WHERE station_id = p_station_id
        AND port_number = p_port_number
        AND status = 'FREE'::port_status
    ) THEN
      RAISE EXCEPTION 'StartSession: порт недоступний без бронювання (очікується статус FREE)';
    END IF;

  ELSE
    -- Перевірка, чи бронювання є дійсним
    SELECT b.user_id, b.vehicle_id
    INTO v_b_user, v_b_vehicle
    FROM booking b
    WHERE b.id = p_booking_id
      AND b.station_id = p_station_id
      AND b.port_number = p_port_number
      AND b.status = 'BOOKED'::booking_status;

    -- Перевірка, чи бронювання знайдено
    IF NOT FOUND THEN
      RAISE EXCEPTION 'StartSession: бронювання не знайдено, не відповідає порту або недійсне';
    END IF;

    IF v_b_user IS NOT NULL AND p_user_id IS NOT NULL AND v_b_user IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'StartSession: бронювання належить іншому користувачу';
    END IF;

    IF v_b_vehicle IS NOT NULL AND p_vehicle_id IS NOT NULL AND v_b_vehicle IS DISTINCT FROM p_vehicle_id THEN
      RAISE EXCEPTION 'StartSession: бронювання прив''язане до іншого авто';
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

-- ДОПОМІЖНІ ПРОЦЕДУРИ
-- -----------------------------------------------------------------------------
-- Скасувати бронювання
CREATE OR REPLACE PROCEDURE CancelBooking(p_booking_id INT)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_booking_id IS NULL OR p_booking_id <= 0 THEN
    RAISE EXCEPTION 'CancelBooking: некоректний p_booking_id';
  END IF;

  UPDATE booking
  SET status = 'CANCELLED'
  WHERE id = p_booking_id AND status = 'BOOKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CancelBooking: бронювання % не знайдено або вже не в статусі BOOKED', p_booking_id;
  END IF;
END;
$$;
