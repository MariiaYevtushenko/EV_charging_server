-- Тригери: обмеження та побічні ефекти на рівні БД (узгоджено з Procedures.sql).


-- ============================================================================
-- SessionCompletedFinalizeBill — після завершення сесії (ACTIVE → COMPLETED):
--    CreateFinalBill (рахунок bill), потім порт цього сеансу USED → FREE (якщо був USED).
CREATE OR REPLACE FUNCTION SessionCompletedFinalizeBill()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'COMPLETED'::session_status AND OLD.status = 'ACTIVE'::session_status 
    THEN
        CALL CreateFinalBill(NEW.id, 'PENDING'::payment_status);

        UPDATE port
        SET status = 'FREE'::port_status, updated_at = CURRENT_TIMESTAMP
        WHERE station_id = NEW.station_id
          AND port_number = NEW.port_number
          AND status = 'USED'::port_status;

    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER trigger_SessionCompletedFinalizeBill
AFTER UPDATE OF status ON session
FOR EACH ROW EXECUTE FUNCTION SessionCompletedFinalizeBill();


-- ============================================================================
-- Оновлення статусу порту після початку сесії
-- Старт сесії (статус ACTIVE): порт FREE → USED.
-- INSERT зі статусом ACTIVE 
-- UPDATE, що переводить рядок у ACTIVE (не повторне оновлення вже ACTIVE).
CREATE OR REPLACE FUNCTION SessionStartedUpdatePort()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'ACTIVE'::session_status THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE'::session_status THEN
        RETURN NEW;
    END IF;

    UPDATE port
    SET status = 'USED'::port_status, updated_at = CURRENT_TIMESTAMP
    WHERE station_id = NEW.station_id
      AND port_number = NEW.port_number
      AND status = 'FREE'::port_status;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_SessionStartedUpdatePort
AFTER INSERT OR UPDATE OF status ON session
FOR EACH ROW EXECUTE FUNCTION SessionStartedUpdatePort();


-- ============================================================================
-- Статус станції: перехід у NOT_WORKING / FIX / ARCHIVED — лише якщо на станції
-- немає жодної сесії ACTIVE (на жодному порту).
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
        'STATION_ACTIVE_SESSION: Наразі триває зарядка на одному з портів станції; неможливо змінити статус станції';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_CheckStationStatusBeforeChange
BEFORE UPDATE OF status ON station
FOR EACH ROW EXECUTE FUNCTION CheckStationStatusBeforeChange();


-- ============================================================================
-- Після зміни статусу станції — синхронізація статусів усіх портів (AFTER UPDATE ON station).
-- NOT_WORKING або ARCHIVED → усі порти NOT_WORKING; FIX → усі REPAIRED; WORK → усі FREE.
-- Перед недоступними статусами спрацьовує CheckStationStatusBeforeChange (немає ACTIVE).
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

CREATE TRIGGER trigger_UpdatePortStatusAfterStationStatusChange
AFTER UPDATE OF status ON station
FOR EACH ROW EXECUTE FUNCTION UpdatePortStatusAfterStationStatusChange();












-- ============================================================================
-- DONE  -- ПІД ПИТАННЯМ
-- CheckBookingOverlap — немає двох BOOKED-броней на один порт з перетином часу.
--    BEFORE INSERT/UPDATE booking; якщо status ≠ BOOKED — перевірка не виконується.
CREATE OR REPLACE FUNCTION CheckBookingOverlap()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status != 'BOOKED' THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 
        FROM booking
        WHERE station_id = NEW.station_id 
          AND port_number = NEW.port_number
          AND status = 'BOOKED'
          AND (NEW.start_time, NEW.end_time) OVERLAPS (start_time, end_time)
          AND id IS DISTINCT FROM NEW.id
    ) THEN
        RAISE EXCEPTION 'Цей порт уже заброньовано на обраний час';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_CheckBookingOverlap
BEFORE INSERT OR UPDATE ON booking
FOR EACH ROW EXECUTE FUNCTION CheckBookingOverlap();
