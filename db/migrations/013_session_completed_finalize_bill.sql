-- Перейменування тригера завершення сесії + порт USED→FREE (узгоджено з server/SQL_scripts/Triggers.sql).
-- Виконати на БД, де ще є старі trigger_GenerateBill / generatebill.

DROP TRIGGER IF EXISTS trigger_generatebill ON session;
DROP FUNCTION IF EXISTS generatebill();

CREATE OR REPLACE FUNCTION SessionCompletedFinalizeBill()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'COMPLETED'::session_status
       AND OLD.status = 'ACTIVE'::session_status THEN
        CALL CreateFinalBill(NEW.id, 'PENDING'::payment_status);
        UPDATE port
        SET
            status = 'FREE'::port_status,
            updated_at = CURRENT_TIMESTAMP
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
