-- Тригери: обмеження та побічні ефекти на рівні БД (узгоджено з Procedures.sql).

-- CheckBookingOverlap — немає двох BOOKED-броней на один порт з перетином часу.
--    BEFORE INSERT/UPDATE booking; якщо status ≠ BOOKED — перевірка не виконується.
CREATE OR REPLACE FUNCTION CheckBookingOverlap()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status <> 'BOOKED' THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM booking
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

-- GenerateBill — після завершення сесії (ACTIVE → COMPLETED) викликає CreateFinalBill (рахунок bill).
--    Початкові payment_method/payment_status — заглушка; деталі оплати — у додатку.
CREATE OR REPLACE FUNCTION GenerateBill()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'COMPLETED'::session_status
       AND OLD.status = 'ACTIVE'::session_status THEN
        CALL CreateFinalBill(
            NEW.id,
            'CARD'::payment_method,
            'PENDING'::payment_status
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_GenerateBill
AFTER UPDATE OF status ON session
FOR EACH ROW EXECUTE FUNCTION GenerateBill();

-- CheckStationPortAvailability — бронювання лише на станцію WORK і порт не REPAIRED.
--    CANCELLED не перевіряється. BEFORE INSERT/UPDATE booking.
CREATE OR REPLACE FUNCTION CheckStationPortAvailability()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'CANCELLED' THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM station 
        WHERE id = NEW.station_id AND status = 'WORK'
        ) THEN
        RAISE EXCEPTION 'Станція наразі не працює або в архіві';
    END IF;

    IF EXISTS (
        SELECT 1 
        FROM port 
        WHERE station_id = NEW.station_id 
        AND port_number = NEW.port_number 
        AND status = 'REPAIRED') THEN
        RAISE EXCEPTION 'Цей порт знаходиться на ремонті';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_CheckStationPortAvailability
BEFORE INSERT OR UPDATE ON booking
FOR EACH ROW EXECUTE FUNCTION CheckStationPortAvailability();

--  IsStatusChangeAllowed — не переводити порт у REPAIRED (ремонт / недоступний для зарядки),
--    якщо на цьому порту є session зі статусом ACTIVE. BEFORE UPDATE status на port.
--  Увага: port_status — лише FREE | BOOKED | USED | REPAIRED (див. EV_Charging_DB.sql).
CREATE OR REPLACE FUNCTION IsStatusChangeAllowed()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.status = 'REPAIRED'::port_status) THEN

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

CREATE TRIGGER trigger_IsStatusChangeAllowed
BEFORE UPDATE OF status ON port
FOR EACH ROW EXECUTE FUNCTION IsStatusChangeAllowed();
