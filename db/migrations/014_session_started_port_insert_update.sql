-- SessionStartedUpdatePort: також INSERT + лише перехід на ACTIVE (узгоджено з Triggers.sql).

DROP TRIGGER IF EXISTS trigger_sessionstartedupdateport ON session;

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
    SET
        status = 'USED'::port_status,
        updated_at = CURRENT_TIMESTAMP
    WHERE station_id = NEW.station_id
      AND port_number = NEW.port_number
      AND status = 'FREE'::port_status;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_SessionStartedUpdatePort
AFTER INSERT OR UPDATE OF status ON session
FOR EACH ROW EXECUTE FUNCTION SessionStartedUpdatePort();
