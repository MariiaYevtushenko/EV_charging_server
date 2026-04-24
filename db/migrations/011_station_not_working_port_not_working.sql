-- station_status: NO_CONNECTION -> NOT_WORKING; port_status: додати NOT_WORKING.
-- Безпечно повторювати: перейменування лише якщо ще є NO_CONNECTION; значення порту — якщо ще немає.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'station_status' AND e.enumlabel = 'NO_CONNECTION'
  ) THEN
    ALTER TYPE station_status RENAME VALUE 'NO_CONNECTION' TO 'NOT_WORKING';
  END IF;
END$$;

ALTER TYPE port_status ADD VALUE IF NOT EXISTS 'NOT_WORKING';

-- Тригери та процедури з актуальними літералами (див. server/SQL_scripts/Triggers.sql, Procedures.sql).
-- CheckStationPortAvailability (booking) прибрано — див. міграцію 012.

CREATE OR REPLACE FUNCTION IsStatusChangeAllowed()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('REPAIRED'::port_status, 'NOT_WORKING'::port_status) THEN

        IF EXISTS (
            SELECT 1
            FROM session
            WHERE station_id = OLD.station_id
            AND port_number = OLD.port_number
            AND status = 'ACTIVE') THEN
            RAISE EXCEPTION 'Неможливо змінити статус! На цьому порту зараз триває зарядка!';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION CheckStationStatusBeforeChange()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN (
       'NOT_WORKING'::station_status,
       'FIX'::station_status,
       'ARCHIVED'::station_status
     ) THEN
    IF EXISTS (
      SELECT 1
      FROM session s
      WHERE s.station_id = OLD.id
        AND s.status = 'ACTIVE'::session_status
    ) THEN
      RAISE EXCEPTION
        'Наразі триває зарядка на одному з портів станції; неможливо змінити статус станції';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION UpdatePortStatusAfterStationStatusChange()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN (
    'NOT_WORKING'::station_status,
    'ARCHIVED'::station_status
  ) THEN
    UPDATE port
    SET status = 'NOT_WORKING'::port_status
    WHERE station_id = NEW.id;
  ELSIF NEW.status = 'FIX'::station_status THEN
    UPDATE port
    SET status = 'REPAIRED'::port_status
    WHERE station_id = NEW.id;
  ELSIF NEW.status = 'WORK'::station_status THEN
    UPDATE port
    SET status = 'FREE'::port_status
    WHERE station_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
      AND status NOT IN ('REPAIRED'::port_status, 'NOT_WORKING'::port_status)
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
      AND b.status = 'BOOKED'::booking_status;

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
