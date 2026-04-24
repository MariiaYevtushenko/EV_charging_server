-- Генерація випадкового пароля
CREATE OR REPLACE FUNCTION GeneratePassword(p_len INT DEFAULT 12)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_=+';
  result TEXT := '';
  clen INT;
  i INT;
  pos INT;
BEGIN
  IF p_len IS NULL OR p_len < 8 THEN
    p_len := 12;
  END IF;
  clen := length(chars);
  FOR i IN 1..p_len LOOP
    pos := 1 + floor(random() * clen)::int;
    result := result || substr(chars, pos, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Створення випадкових користувачів
CREATE OR REPLACE PROCEDURE SeedMassiveUsers(p_count INT DEFAULT 1000)
LANGUAGE plpgsql
AS $$
DECLARE
  first_names TEXT[] := ARRAY[
    'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
    'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua',
    'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob',
    'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin',
    'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Margaret', 'Dorothy', 'Lisa'
  ];
  last_names TEXT[] := ARRAY[
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thompson',
    'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'White', 'Harris',
    'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen',
    'King', 'Wright', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams',
    'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
    'Gomez', 'Phillips', 'Evans', 'Turner', 'Parker', 'Collins', 'Edwards', 'Stewart'
  ];
  email_domains TEXT[] := ARRAY[
    'gmail.com', 'ukr.net', 'i.ua', 'meta.ua', 'bigmir.net', 'outlook.com', 'yahoo.com', 'proton.me', 'ev-charge.com'
  ];
  mobile_prefixes TEXT[] := ARRAY[
    '50', '66', '95', '99', '67', '68', '97', '98', '63', '73', '93'
  ];
  v_name TEXT;
  v_surname TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_role user_role;
  v_random_num INT;
  v_password TEXT;
  first_names_len INT;
  last_names_len INT;
BEGIN
  first_names_len := array_length(first_names, 1);
  last_names_len := array_length(last_names, 1);

  -- Вставка випадкових користувачів 
  FOR i IN 1..p_count LOOP

    v_name := first_names[1 + floor(random() * first_names_len)::int];
    v_surname := last_names[1 + floor(random() * last_names_len)::int];

    v_random_num := floor(random() * 999)::int;
    v_email := lower(v_name) || '.' || i::text || v_random_num::text || '.' || lower(v_surname) || '@' ||
      email_domains[1 + floor(random() * array_length(email_domains, 1))::int];
      
    v_phone := '+380' ||
      mobile_prefixes[1 + floor(random() * array_length(mobile_prefixes, 1))::int] || (1000000 + floor(random() * 8999999))::text;
   
    IF random() < 0.05 THEN
      v_role := 'STATION_ADMIN';
    ELSE
      v_role := 'USER';
    END IF;

    v_password := GeneratePassword(12);

    INSERT INTO ev_user (name, surname, email, phone_number, password_hash, role, created_at)
    VALUES (v_name, v_surname, v_email, v_phone, v_password, v_role, NOW() - (random() * INTERVAL '365 days'))
    ON CONFLICT (email) DO NOTHING;

  END LOOP;

  RAISE NOTICE 'SeedMassiveUsers: додано до % облікових записів', p_count;
END;
$$;

-- Заповнення таблиці booking
CREATE OR REPLACE PROCEDURE SeedBookings(
  p_bookings INT DEFAULT 2000,
  p_days_back INT DEFAULT 120
)
LANGUAGE plpgsql
AS $$
DECLARE
  i INT;
  v_user_id INT;
  v_vehicle_id INT;
  v_station_id INT;
  v_port_number INT;
  v_start TIMESTAMP;
  v_end TIMESTAMP;
  v_status booking_status;
  v_booking_type booking_type;
  v_prepayment_amount NUMERIC(10, 2);
  v_future_booking BOOLEAN;
  r_status NUMERIC;
  v_repeat_user BOOLEAN;
  insert_ok BOOLEAN;
  try_n INT;
  slot_try INT;
BEGIN

-- Перевірка кількості створюваних броней
  IF p_bookings IS NULL OR p_bookings < 1 THEN
    p_bookings := 3000;
  END IF;
  IF p_bookings > 10000 THEN
    p_bookings := 10000;
  END IF;

-- Перевірка максимальної дати назад 
  IF p_days_back IS NULL OR p_days_back < 1 THEN
    p_days_back := 120;
  END IF;
  IF p_days_back > 1200 THEN
    p_days_back := 1200;
  END IF;

-- Перевірка чи є користувачі з автомобілями
  IF NOT EXISTS (
    SELECT 1
    FROM ev_user u
    INNER JOIN vehicle v ON v.user_id = u.id
    WHERE u.role = 'USER'::user_role
  ) THEN
    RAISE NOTICE 'SeedBookings: відсутні користувачі з автомобілями';
    RETURN;
  END IF;

-- Перевірка чи є робочі порти (не REPAIRED / NOT_WORKING) та станції(WORK)
  IF NOT EXISTS (
    SELECT 1
    FROM port p
    INNER JOIN station s ON s.id = p.station_id
    WHERE s.status = 'WORK'::station_status
      AND p.status NOT IN ('REPAIRED'::port_status, 'NOT_WORKING'::port_status)
    LIMIT 1
  ) THEN
    RAISE NOTICE 'SeedBooking: відсутні робочі порти та станції';
    RETURN;
  END IF;


-- Створення бронювань
  FOR i IN 1..p_bookings LOOP
  
  -- Створення бронювання для нового користувача чи для старого в кого вже є бронювання
  -- ** Перші 100 тільки для нових користувачів. Далі користувачі можуть повторюватися
    v_repeat_user := (i > 100 AND random() < 0.4 AND EXISTS (SELECT 1 FROM booking LIMIT 1));

    -- Якщо повторюваний користувач, то обираємо випадковго користувача з Booking
    IF v_repeat_user THEN
      SELECT t.user_id, t.vehicle_id
      INTO v_user_id, v_vehicle_id
      FROM (
        SELECT DISTINCT b.user_id, b.vehicle_id
        FROM booking b
      ) t
      ORDER BY random()
      LIMIT 1;
    ELSE
    -- Якщо новий користувач, то випадкова пара користувач-авто
      SELECT u.id, v.id
      INTO v_user_id, v_vehicle_id
      FROM ev_user u
      INNER JOIN vehicle v ON v.user_id = u.id
      WHERE u.role = 'USER'::user_role
      ORDER BY random()
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL OR v_vehicle_id IS NULL THEN
      RAISE NOTICE 'SeedBookings: не обрано користувача або автомобіль (ітерація %)', i;
      CONTINUE;
    END IF;

    -- Створення майбутнього або минулого бронивання
    v_future_booking := (random() < 0.40);

    -- Якщо майбутнє бронювання то на 21 день вперед максимум
    -- Якщо минуле бронювання то дата початку випадково в межах останніх p_days_back календарних днів
    IF v_future_booking THEN

      v_start :=
        date_trunc('day', now())
        + (floor(random() * 22) * interval '1 day')
        + (floor(random() * 24) || ' hours')::interval
        + ((floor(random() * 12) * 5) || ' minutes')::interval;

    -- Додаткова перевірка, щоб майбутнє бронювання не було в минулому( більше за поточну дату)
      WHILE v_start <= now() LOOP
        v_start := v_start + interval '1 day';
      END LOOP;

      -- Кінець бронювання випадково в межах 1-4 годин
      v_end := v_start + (interval '1 hour' * (1.0 + random() * 3.5));


      r_status := random();
      -- Створити скасоване(CANCELLED) або заброньоване(BOOKED)
      IF r_status < 0.15 THEN
        v_status := 'CANCELLED'::booking_status;
      ELSE
        v_status := 'BOOKED'::booking_status;
      END IF;

    ELSE
      -- Якщо минуле бронювання
      v_start :=
        date_trunc('day', now() - (floor(random() * p_days_back) * interval '1 day'))
        + (floor(random() * 24) || ' hours')::interval  
        + ((floor(random() * 12) * 5) || ' minutes')::interval;

-- Тривалість минулого бронювання: випадково від 30 хв до 4 год (цілі хвилини)
      v_end := v_start + (30 + floor(random() * 211)) * interval '1 minute';
      r_status := random();

 -- Минулі: MISSED, CANCELLED, COMPLETED.
      IF r_status < 0.1 THEN
        v_status := 'MISSED'::booking_status;
      ELSIF r_status < 0.3 THEN
        v_status := 'CANCELLED'::booking_status;
      ELSE
        v_status := 'COMPLETED'::booking_status;
      END IF;
    END IF;

   -- Тип бронювання(CALC-прогноз, DEPOSIT- завдаток)
    v_booking_type := CASE 
      WHEN random() < 0.50 
      THEN 'CALC'::booking_type 
      ELSE 'DEPOSIT'::booking_type END;
   
   -- Сума оплати (цілі гривні)
    -- CALC: 4–15 грн; DEPOSIT: 100–400 грн
    v_prepayment_amount := CASE
      WHEN v_booking_type = 'CALC'::booking_type 
      THEN (4 + floor(random() * 12))::numeric
      ELSE (100 + floor(random() * 301))::numeric
    END;

    insert_ok := false;
    try_n := 0;

    WHILE NOT insert_ok AND try_n < 50 LOOP
      try_n := try_n + 1;

    -- Вибір випадкового порту та станції
      SELECT p.station_id, p.port_number
      INTO v_station_id, v_port_number
      FROM port p
      INNER JOIN station s ON s.id = p.station_id
      WHERE s.status = 'WORK'::station_status
        AND p.status NOT IN ('REPAIRED'::port_status, 'NOT_WORKING'::port_status)
      ORDER BY random()
      LIMIT 1;

      IF v_station_id IS NULL OR v_port_number IS NULL THEN
        RAISE NOTICE 'SeedBookings: ітерація % — порт не вибрано', i;
        EXIT;
      END IF;

  
      IF v_status = 'BOOKED'::booking_status THEN
        slot_try := 0;

      -- Перевірка на перетин бронювань в часі (зміна часу при накладанні)
        WHILE slot_try < 32 LOOP
          slot_try := slot_try + 1;

          -- Якщо немає перетину бронювань в часі, то вихід
          EXIT WHEN NOT EXISTS (
            SELECT 1
            FROM booking b
            WHERE b.station_id = v_station_id
              AND b.port_number = v_port_number
              AND b.status = 'BOOKED'::booking_status
              AND (v_start, v_end) OVERLAPS (b.start_time, b.end_time)
          ); 

         -- Майбутнє, зсув 
          IF v_future_booking THEN
            v_start :=
              date_trunc('day', now())
              + (floor(random() * 22) * interval '1 day')
              + (floor(random() * 24) || ' hours')::interval
              + ((floor(random() * 12) * 5) || ' minutes')::interval;
            WHILE v_start <= now() LOOP
              v_start := v_start + interval '1 day';
            END LOOP;
            v_end := v_start + (interval '1 hour' * (1.0 + random() * 3.5));
          ELSE
          --  минуле, зсув (ті самі правила заокруглення)
            v_start :=
              date_trunc('day', now() - (floor(random() * p_days_back) * interval '1 day'))
              + (floor(random() * 24) || ' hours')::interval
              + ((floor(random() * 12) * 5) || ' minutes')::interval;
            v_end := v_start + (30 + floor(random() * 211)) * interval '1 minute';
          END IF;

        END LOOP;

     -- Якщо є перетину бронювань в часі, то спроба знову нове значення станції та порта
        IF EXISTS (
          SELECT 1
          FROM booking b
          WHERE b.station_id = v_station_id
            AND b.port_number = v_port_number
            AND b.status = 'BOOKED'::booking_status
            AND (v_start, v_end) OVERLAPS (b.start_time, b.end_time)
        ) THEN
          CONTINUE;
        END IF;

      END IF;

      BEGIN
        INSERT INTO booking (
          user_id, vehicle_id, station_id, port_number,
          start_time, end_time, status, booking_type, prepayment_amount
        )
        VALUES (
          v_user_id, v_vehicle_id, v_station_id, v_port_number,
          v_start, v_end, v_status, v_booking_type, v_prepayment_amount
        );
        insert_ok := true;
      END;
    END LOOP;

   
  END LOOP;

  RAISE NOTICE 'SeedBookings: створено % бронювань', (SELECT COUNT(*) FROM booking);
END;
$$;



-- Створення сесій з минулих бронювань
CREATE OR REPLACE PROCEDURE SeedSessionsFromBookings(
  p_count INT DEFAULT 0
)
LANGUAGE plpgsql
AS $$
DECLARE
  booking RECORD;
  v_battery_capacity NUMERIC;
  is_active BOOLEAN;
  v_slot_start TIMESTAMP;
  v_slot_end TIMESTAMP;
  v_swap TIMESTAMP;
  sess_start TIMESTAMP;
  sess_end TIMESTAMP;
  sess_status session_status;
  kwh NUMERIC;
BEGIN
-- Кількість сесій яка буде мати поперееднє бронювання
-- Перевірка кількості
  IF p_count IS NULL OR p_count < 1 THEN
    RETURN;
  END IF;

-- для кожного брогювання яке не є скасованим або пропущеним створюємо сесію
  FOR booking IN (
    SELECT b.*
    FROM booking b
    WHERE b.start_time < now()
      AND b.status NOT IN ('CANCELLED'::booking_status, 'MISSED'::booking_status)
    ORDER BY random()
    LIMIT p_count
    )
  LOOP
    SELECT v.battery_capacity::numeric
    INTO v_battery_capacity
    FROM vehicle v
    WHERE v.id = booking.vehicle_id;

    v_slot_end := booking.end_time;
    v_slot_start := booking.start_time;

    -- Активна лише якщо вікно броні ще триває і випадково обрано «активну» сесію
    is_active := booking.start_time <= now() AND booking.end_time > now() AND random() < 0.45;

    IF is_active THEN
    -- Якщо сесія активна, то статус ACTIVE
      sess_status := 'ACTIVE'::session_status;

      sess_start := booking.start_time + (interval '1 minute' * (1.0 + random() * 15.0));

      IF sess_start > now() THEN
        sess_start := now();
      END IF;

      sess_end := NULL; -- Поки не закінчилась сесія
      kwh := round((random() * v_battery_capacity)::numeric, 3);

    ELSE
      IF random() < 0.88 THEN
        -- Завершена сесія
        sess_status := 'COMPLETED'::session_status;

        -- Початок сесії випадково в межах 1–15 хв від початку бронювання
        sess_start := v_slot_start + (interval '1 minute' * (1.0 + random() * 15.0));

        -- Кінець сесії випадково в межах 1–14 хв від кінця бронювання
        sess_end := v_slot_end - (interval '1 minute' * (1.0 + random() * 14.0));

        -- Якщо кінець не пізніше за початок — міняємо місцями
        IF sess_end <= sess_start THEN
          v_swap := sess_start;
          sess_start := sess_end;
          sess_end := v_swap;
        END IF;

        IF sess_end > now() THEN
          sess_end := now();
        END IF;

        kwh := round((random() * v_battery_capacity)::numeric, 3);
      ELSE
        sess_status := 'FAILED'::session_status;

        sess_start := v_slot_start + interval '1 minute';
        sess_end := sess_start + interval '1 minute';

        kwh := 0;
      END IF;
    END IF;

    INSERT INTO session (
      user_id, vehicle_id, station_id, port_number, booking_id,
      start_time, end_time, kwh_consumed, status
    )
    VALUES (
      booking.user_id,
      booking.vehicle_id,
      booking.station_id,
      booking.port_number,
      booking.id,
      sess_start,
      sess_end,
      kwh,
      sess_status
    );

    IF sess_status = 'ACTIVE'::session_status THEN
      UPDATE port
      SET status = 'USED'::port_status, updated_at = CURRENT_TIMESTAMP
      WHERE station_id = booking.station_id
        AND port_number = booking.port_number;
    END IF;
  END LOOP;
END;
$$;

-- Створення сесій без бронювання
CREATE OR REPLACE PROCEDURE SeedSessionsWalkIn(
  p_count INT DEFAULT 1500,
  p_days_back INT DEFAULT 120
)
LANGUAGE plpgsql
AS $$
DECLARE
  i INT;
  v_uid INT;
  v_vid INT;
  v_station_id INT;
  v_port_number INT;
  r NUMERIC;
  sess_status session_status;
  sess_start TIMESTAMP;
  sess_end TIMESTAMP;
  kwh_consumed NUMERIC;
  v_battery_capacity NUMERIC;
  v_days_back INT;
BEGIN

  IF p_count IS NULL OR p_count < 1 THEN
    RETURN;
  END IF;

  -- IN-параметри в PL/pgSQL не можна змінювати — лише локальна копія
  v_days_back := COALESCE(NULLIF(p_days_back, 0), 120);
  IF v_days_back < 1 THEN
    v_days_back := 1;
  END IF;
  IF v_days_back > 1200 THEN
    v_days_back := 1200;
  END IF;

  FOR i IN 1..p_count LOOP
  -- Вибір випадкового користувача та автомобіля
    SELECT u.id, v.id
    INTO v_uid, v_vid
    FROM ev_user u
    INNER JOIN vehicle v ON v.user_id = u.id
    WHERE u.role = 'USER'::user_role
    ORDER BY random()
    LIMIT 1;

    -- Вибір випадкового порту та станції
    SELECT p.station_id, p.port_number
    INTO v_station_id, v_port_number
    FROM port p
    INNER JOIN station s ON s.id = p.station_id
    WHERE s.status = 'WORK'::station_status
      AND p.status NOT IN ('REPAIRED'::port_status, 'NOT_WORKING'::port_status)
    ORDER BY random()
    LIMIT 1;

-- Вибір випадкового статусу сесії
    r := random();
    IF r < 0.15 THEN
      sess_status := 'ACTIVE'::session_status;
    ELSIF r < 0.90 THEN
      sess_status := 'COMPLETED'::session_status;
    ELSE
      sess_status := 'FAILED'::session_status;
    END IF;

    SELECT v.battery_capacity::numeric
    INTO v_battery_capacity
    FROM vehicle v
    WHERE v.id = v_vid;

    IF sess_status = 'ACTIVE'::session_status THEN
      -- Початок сесії випадково від 1 до 3 годин тому
      sess_start := (now() - (interval '1 hour' + random() * interval '2 hours'))::timestamp;
      sess_end := NULL;
      kwh_consumed := round((random() * v_battery_capacity)::numeric, 3);
    ELSIF sess_status = 'COMPLETED'::session_status THEN
      sess_start := (now() - (random() * v_days_back * interval '1 day'))::timestamp;
      sess_end := sess_start + (interval '1 minute' * (6 + random() * 40));
      kwh_consumed := round((random() * v_battery_capacity)::numeric, 3);
    ELSE
      sess_start := (now() - (random() * v_days_back * interval '1 day'))::timestamp;
      sess_end := sess_start + (interval '1 minute' * (4 + random() * 25));
      kwh_consumed := 0;
    END IF;

    INSERT INTO session (
      user_id, vehicle_id, station_id, port_number, booking_id, start_time, end_time, kwh_consumed, status
    )
    VALUES (v_uid, v_vid, v_station_id, v_port_number, NULL, sess_start, sess_end, kwh_consumed, sess_status);

    IF sess_status = 'ACTIVE'::session_status THEN
      UPDATE port
      SET status = 'USED'::port_status, updated_at = CURRENT_TIMESTAMP
      WHERE station_id = v_station_id
        AND port_number = v_port_number;
    END IF;
  END LOOP;
END;
$$;


-- Створення рахунків для завершених сесій
CREATE OR REPLACE PROCEDURE SeedBills()
LANGUAGE plpgsql
AS $$
DECLARE
  session_row RECORD;
  v_calculated NUMERIC;
  v_price_saved NUMERIC;
  v_method payment_method;
  v_pay_status payment_status;
  v_paid_at TIMESTAMP;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM session
    WHERE status = 'COMPLETED'::session_status AND end_time IS NOT NULL
  ) THEN
    RAISE NOTICE 'SeedBills: немає завершених сесій — спочатку SeedSessions.';
    RETURN;
  END IF;

  FOR session_row IN
    SELECT s.id, s.kwh_consumed, s.end_time
    FROM session s
    WHERE s.status = 'COMPLETED'::session_status
      AND s.end_time IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM bill b WHERE b.session_id = s.id)
  LOOP
    SELECT calculated_amount, price_per_kwh
    INTO STRICT v_calculated, v_price_saved
    FROM GetFinalSessionAmount(session_row.id);

    IF random() < 0.90 THEN
      v_pay_status := 'SUCCESS'::payment_status;
      CASE floor(random() * 3)::int
        WHEN 0 THEN v_method := 'CARD'::payment_method;
        WHEN 1 THEN v_method := 'APPLE_PAY'::payment_method;
        ELSE v_method := 'GOOGLE_PAY'::payment_method;
      END CASE;
      v_paid_at := session_row.end_time + (random() * interval '3 hours');
    ELSE
      v_pay_status := 'PENDING'::payment_status;
      v_method := NULL;
      v_paid_at := NULL;
    END IF;

    INSERT INTO bill (
      session_id,
      calculated_amount,
      price_per_kwh_at_time,
      payment_method,
      payment_status,
      paid_at
    )
    VALUES (
      session_row.id,
      v_calculated,
      v_price_saved,
      v_method,
      v_pay_status,
      v_paid_at
    );
  END LOOP;

  RAISE NOTICE 'SeedBills: рахунків=%', (SELECT COUNT(*) FROM bill);
END;
$$;


CREATE OR REPLACE PROCEDURE SeedSessions(
  p_clear_before BOOLEAN DEFAULT true,
  p_target_sessions INT DEFAULT NULL,
  p_from_booking_share NUMERIC DEFAULT 0.5
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_target INT;
  v_goal_book INT;
  v_n_book INT;
  v_n_walk INT;
  eligible_cnt INT;
  v_share NUMERIC;
BEGIN
  IF p_clear_before THEN
    DELETE FROM session;
  END IF;

  v_target := COALESCE(NULLIF(p_target_sessions, 0), 2000);
  IF v_target < 2 THEN
    v_target := 2;
  END IF;

  v_share := COALESCE(p_from_booking_share, 0.5);
  IF v_share < 0 THEN
    v_share := 0;
  END IF;
  IF v_share > 1 THEN
    v_share := 1;
  END IF;

  SELECT COUNT(*)
  INTO eligible_cnt
  FROM booking b
  WHERE b.start_time < now()
    AND b.status NOT IN ('CANCELLED'::booking_status, 'MISSED'::booking_status);

  v_goal_book := LEAST(
    v_target,
    GREATEST(0, FLOOR(v_target * v_share)::int)
  );
  v_n_book := LEAST(v_goal_book, GREATEST(eligible_cnt, 0));
  v_n_walk := v_target - v_n_book;

  CALL SeedSessionsFromBookings(v_n_book);
  CALL SeedSessionsWalkIn(v_n_walk);

  -- Порти за статусом станції (узгоджено з тригером UpdatePortStatusAfterStationStatusChange)
  UPDATE port p
  SET status = 'REPAIRED'::port_status, updated_at = CURRENT_TIMESTAMP
  FROM station s
  WHERE s.id = p.station_id
    AND s.status = 'FIX'::station_status;

  UPDATE port p
  SET status = 'NOT_WORKING'::port_status, updated_at = CURRENT_TIMESTAMP
  FROM station s
  WHERE s.id = p.station_id
    AND s.status IN ('NOT_WORKING'::station_status, 'ARCHIVED'::station_status);

  RAISE NOTICE
    'SeedSessions: усього сесій=%, з бронюванням=%, без бронювання=% (ціль=%, eligible броней=%)',
    (SELECT COUNT(*) FROM session),
    (SELECT COUNT(*) FROM session WHERE booking_id IS NOT NULL),
    (SELECT COUNT(*) FROM session WHERE booking_id IS NULL),
    v_target,
    eligible_cnt;
END;
$$;


CREATE OR REPLACE PROCEDURE SeedBookingsSessionsBills(
  p_bookings INT DEFAULT 2000,
  p_session_target INT DEFAULT NULL,
  p_from_booking_share NUMERIC DEFAULT 0.5,
  p_days_back INT DEFAULT 120
)
LANGUAGE plpgsql
AS $$
BEGIN
  CALL SeedBookings(p_bookings, p_days_back);
  CALL SeedSessions(
    true,
    COALESCE(NULLIF(p_session_target, 0), p_bookings),
    p_from_booking_share
  );
  CALL SeedBills();
  RAISE NOTICE 'SeedBookingsSessionsBills: booking=%, session=%, bill=%, майбутніх броней (без сесії): %',
    (SELECT COUNT(*) FROM booking),
    (SELECT COUNT(*) FROM session),
    (SELECT COUNT(*) FROM bill),
    (SELECT COUNT(*) FROM booking WHERE start_time >= now() AND status <> 'CANCELLED'::booking_status);
END;
$$;
