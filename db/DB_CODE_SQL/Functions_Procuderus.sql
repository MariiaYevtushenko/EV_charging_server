
-- ============================================================================
-- Отримання ціни тарифу на обраний момент (день/ніч за годиною p_date_at).
CREATE OR REPLACE FUNCTION GetTariffPricePerKwhAt(
  p_date_at TIMESTAMP
)
RETURNS DECIMAL(10, 2) AS $$
DECLARE
  v_day DATE;
  v_price DECIMAL(10, 2);
  v_tariff_type tariff_period;
BEGIN
  v_day := (p_date_at)::date;

  v_tariff_type := GetTariffPeriodType(p_date_at);

  SELECT t.price_per_kwh
  INTO v_price
  FROM tariff t
  WHERE t.tariff_type = v_tariff_type AND t.effective_date <= v_day
  ORDER BY t.effective_date DESC
  LIMIT 1;

  -- Якщо сесія старіша за найраніший тариф у БД (наприклад сид сесій на 200 днів vs тарифи на 90)
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Не знайдено тарифу на дату %', v_day;
  END IF;

  RETURN v_price;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================================
-- Отримання типу тарифу на обраний момент (день/ніч за годиною p_time)
CREATE OR REPLACE FUNCTION GetTariffPeriodType(p_datatime TIMESTAMP)
RETURNS tariff_period AS $$
DECLARE
  v_t TIME;
BEGIN
  v_t := (p_datatime)::time;

  IF v_t >= time '07:00' AND v_t < time '23:00' THEN
    RETURN 'DAY'::tariff_period;
  END IF;
  RETURN 'NIGHT'::tariff_period;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================================
-- Отримання суми до сплати та ціни кВт·год для сесії
CREATE OR REPLACE FUNCTION GetFinalSessionAmount(p_session_id INT)
RETURNS TABLE(calculated_amount DECIMAL(10, 2), price_per_kwh DECIMAL(10, 2)) AS $$
DECLARE
  v_booking_id INT;
  v_booking_type booking_type;
  v_prepayment DECIMAL(10, 2);
  v_kwh_consumed DECIMAL(10, 3);
  v_tariff_price DECIMAL(10, 2);
  v_start_time TIMESTAMP;
  v_final DECIMAL(10, 2);
  v_session_id INT;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Сесія не може бути NULL';
    RETURN;
  END IF;

  SELECT s.id, s.booking_id, s.kwh_consumed, s.start_time
  INTO v_session_id, v_booking_id, v_kwh_consumed, v_start_time
  FROM session s
  WHERE s.id = p_session_id;

  SELECT b.prepayment_amount, b.booking_type
  INTO v_prepayment, v_booking_type
  FROM booking b
  WHERE b.id = v_booking_id;

-- Якщо бронювання типу CALC, то v_prepayment - ціна за електрику (прогнозована в квт год)
  IF v_booking_type IS NOT NULL AND v_booking_type = 'CALC'::booking_type THEN
    v_tariff_price := v_prepayment;
   
  ELSE
--  - Якщо це  бронювання типу DEPOSIT або просто сесія без бронювання
    v_tariff_price := GetTariffPricePerKwhAt(v_start_time);

     -- Якщо бронювання типу DEPOSIT, то v_prepayment - передплата
    IF v_booking_id IS NOT NULL THEN
       v_prepayment := v_prepayment;    
    END IF;
  END IF;

  v_final := ROUND((v_kwh_consumed * v_tariff_price) + COALESCE(v_prepayment, 0), 2);

  RETURN QUERY SELECT v_final, v_tariff_price;
END;
$$ LANGUAGE plpgsql;


-- Отримання списку вільних стотів для порту станції на обраний день
-- вказується тривалість слоту(мінімальний) сесії та кількість слотів
CREATE OR REPLACE FUNCTION GetAvailableBookingSlots(
  p_station_id INT,
  p_port_number INT,
  p_date DATE,
  p_slot_size_minutes INTERVAL,
  p_units INT
)
RETURNS TABLE(available_start TIMESTAMP, available_end TIMESTAMP) AS $$
DECLARE
  v_total_duration INTERVAL := p_slot_size_minutes * p_units;
  v_step INTERVAL := p_slot_size_minutes;
BEGIN

-- Слоти для початку сесій
  RETURN QUERY
  WITH FreeSlotsStarts AS (
    SELECT generate_series(
      p_date::timestamp,
      (p_date + interval '1 day' - v_total_duration),
      v_step
    ) AS s_start
  )

  -- обрати  всі слоти що не перетинаються з бронюваннями
  -- перевіряються всі попередні бронювання з потенційним слотом  так щоб вони не перетиналися
  -- якщо немає перетину, то слот NOT EXIST (false) -> додати в результат
  -- якщо є перетину, то слот EXIST (true) -> не додати в результат
  SELECT
    fss.s_start,
    fss.s_start + v_total_duration
  FROM FreeSlotsStarts fss
  WHERE NOT EXISTS (
    SELECT 1
    FROM booking b
    WHERE b.station_id = p_station_id
      AND b.port_number = p_port_number
      AND b.status = 'BOOKED'
      AND (fss.s_start, fss.s_start + v_total_duration)
        OVERLAPS (b.start_time, b.end_time)
  );
END;
$$ LANGUAGE plpgsql;



-- ========================================================================================
-- ПРОЦЕДУРИ
-- ========================================================================================

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
    RAISE EXCEPTION 'Некоректний p_session_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM session WHERE id = p_session_id) THEN
    RAISE EXCEPTION 'Сесії з id % не існує', p_session_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM session
    WHERE id = p_session_id AND status = 'COMPLETED'::session_status
  ) THEN
    RAISE EXCEPTION
      'Сесія % має бути в статусі COMPLETED (рахунок створюється після завершення зарядки)',
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
      'Сесія % не в статусі ACTIVE',
      p_session_id;
  END IF;

  IF p_final_kwh < 0 THEN
    RAISE EXCEPTION 'kwh_consumed не може бути від''ємним (отримано %)', p_final_kwh;
  END IF;

  UPDATE session
  SET
    end_time = CURRENT_TIMESTAMP,
    kwh_consumed = p_final_kwh,
    status = 'COMPLETED'
  WHERE id = p_session_id
    AND status = 'ACTIVE'::session_status;
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
    RAISE EXCEPTION 'Некоректний p_bill_id';
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
      RAISE EXCEPTION 'Рахунок % вже оплачено або не в статусі PENDING', p_bill_id;
    ELSE
      RAISE EXCEPTION 'Рахунок з id % не знайдено', p_bill_id;
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
    RAISE EXCEPTION 'Некоректні p_station_id або p_port_number';
  END IF;

  -- Перевірка, чи на цьому порту вже є активна сесія зарядки
  IF EXISTS (
    SELECT 1 FROM session s
    WHERE s.station_id = p_station_id
      AND s.port_number = p_port_number
      AND s.status = 'ACTIVE'::session_status
  ) THEN
    RAISE EXCEPTION 'На цьому порту вже є активна сесія зарядки';
  END IF;

  -- Перевірка, чи станція працює
  IF NOT EXISTS (
    SELECT 1
    FROM station
    WHERE id = p_station_id AND status = 'WORK'::station_status
  ) THEN
    RAISE EXCEPTION 'Станція наразі не працює або в архіві';
  END IF;

  -- Перевірка, чи порт доступний для старту
  IF NOT EXISTS (
    SELECT 1 FROM port
    WHERE station_id = p_station_id
      AND port_number = p_port_number
      AND status NOT IN ('REPAIRED'::port_status, 'NOT_WORKING'::port_status)
  ) THEN
    RAISE EXCEPTION 'Порт не знайдено або на ремонті';
  END IF;

  -- Перевірка, чи порт доступний для старту без бронювання
  IF p_booking_id IS NULL THEN

    IF NOT EXISTS (
      SELECT 1 FROM port
      WHERE station_id = p_station_id
        AND port_number = p_port_number
        AND status = 'FREE'::port_status
    ) THEN
      RAISE EXCEPTION 'Порт недоступний без бронювання (очікується статус FREE)';
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

-- ДОПОМІЖНІ ПРОЦЕДУРИ
-- -----------------------------------------------------------------------------
-- Скасувати бронювання
CREATE OR REPLACE PROCEDURE CancelBooking(p_booking_id INT)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_booking_id IS NULL OR p_booking_id <= 0 THEN
    RAISE EXCEPTION 'Некоректний p_booking_id';
  END IF;

  UPDATE booking
  SET status = 'CANCELLED'
  WHERE id = p_booking_id AND status = 'BOOKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Бронювання % не знайдено або вже не в статусі BOOKED', p_booking_id;
  END IF;
END;
$$;
