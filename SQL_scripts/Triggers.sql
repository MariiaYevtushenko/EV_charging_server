-- =============================================================================
-- ТРИГЕРИ (бізнес-правила на рівні БД)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) trigger_booking_02_overlap — неможливість перетину інтервалів бронювання
-- -----------------------------------------------------------------------------
-- Правило: на один порт у статусі BOOKED не може бути двох перетинних за часом
-- бронювань (новий рядок або зміна часу/порту).
-- Коли: BEFORE INSERT OR UPDATE на таблиці booking.
-- Виняток: якщо статус бронювання не BOOKED, перевірка перетину не виконується.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2) trigger_GenerateBill — автоматичне створення рахунку після зарядки
-- -----------------------------------------------------------------------------
-- Правило: коли сесія зарядки завершена (статус ACTIVE → COMPLETED), у БД
-- має з’явитися відповідний рядок bill із розрахованою сумою (через CreateFinalBill).
-- Тригер лише створює рахунок; CARD + PENDING — початкові значення (payment_method NOT NULL).
-- Реальний спосіб оплати та підтвердження користувач задає в UI, API оновлює bill.
-- Коли: AFTER UPDATE OF status на таблиці session.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 3) trigger_booking_03_station_port — бронювання лише на доступну інфраструктуру
-- -----------------------------------------------------------------------------
-- Правило: не приймати бронювання, якщо станція не в робочому стані (WORK) або
-- порт на ремонті (REPAIRED). Скасовані бронювання (CANCELLED) не блокуються.
-- Коли: BEFORE INSERT OR UPDATE на таблиці booking (новий слот або зміна порту/часу).
-- -----------------------------------------------------------------------------
-- Порада: У тебе в таблиці station є статус FIX (ремонт). Можливо, варто змінити 
-- умову перевірки станції на таку:
-- code
-- SQL
-- IF EXISTS (
--     SELECT 1 FROM station 
--     WHERE id = NEW.station_id AND status IN ('FIX', 'NO_CONNECTION', 'ARCHIVED')
-- ) THEN 
--     RAISE EXCEPTION 'Станція недоступна для бронювання (ремонт або відсутній зв’язок)';
-- END IF;
CREATE OR REPLACE FUNCTION CheckStationPortAvailability()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'CANCELLED' THEN
        RETURN NEW;
    END IF;

    -- Перевірка станції
    IF NOT EXISTS (
        SELECT 1 
        FROM station 
        WHERE id = NEW.station_id AND status = 'WORK'
        ) THEN
        RAISE EXCEPTION 'Станція наразі не працює або в архіві';
    END IF;

    -- Перевірка порту
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

-- -----------------------------------------------------------------------------
-- 4) trigger_IsStatusChangeAllowed — заборона «вимкнути» порт під час зарядки
-- -----------------------------------------------------------------------------
-- Правило: не можна перевести порт у стан FIX, ARCHIVED або NO_CONNECTION, якщо
-- на цьому ж порту є активна сесія зарядки (session.status = ACTIVE).
-- Коли: BEFORE UPDATE OF status на таблиці port (дії адміністратора).
-- -----------------------------------------------------------------------------
-- Порада: Переконайся, що в коді програми start_time завжди менше за 4
-- end_time (хоча PostgreSQL OVERLAPS зазвичай справляється, краще мати 
--CHECK (end_time > start_time) у схемі таблиці).
CREATE OR REPLACE FUNCTION IsStatusChangeAllowed()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.status IN ('FIX', 'ARCHIVED', 'NO_CONNECTION')) THEN

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
