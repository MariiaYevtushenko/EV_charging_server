-- Прибрати значення BOOKED з enum port_status (узгоджено з EV_Charging_DB.sql / Prisma).
-- Тригер BEFORE UPDATE OF status на port блокує ALTER TYPE стовпця — тимчасово знімаємо його та функцію.

UPDATE port SET status = 'FREE'::port_status WHERE status::text = 'BOOKED';

DROP TRIGGER IF EXISTS trigger_isstatuschangeallowed ON port;
DROP FUNCTION IF EXISTS isstatuschangeallowed() CASCADE;

ALTER TYPE port_status RENAME TO port_status_old;

CREATE TYPE port_status AS ENUM ('FREE', 'USED', 'REPAIRED', 'NOT_WORKING');

ALTER TABLE port
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE port
  ALTER COLUMN status TYPE port_status
  USING (
    CASE status::text
      WHEN 'FREE' THEN 'FREE'::port_status
      WHEN 'USED' THEN 'USED'::port_status
      WHEN 'REPAIRED' THEN 'REPAIRED'::port_status
      WHEN 'NOT_WORKING' THEN 'NOT_WORKING'::port_status
      ELSE 'FREE'::port_status
    END
  );

ALTER TABLE port
  ALTER COLUMN status SET DEFAULT 'FREE'::port_status;

DROP TYPE port_status_old;

-- Відновлення (як у server/SQL_scripts/Triggers.sql)
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

CREATE TRIGGER trigger_IsStatusChangeAllowed
BEFORE UPDATE OF status ON port
FOR EACH ROW EXECUTE FUNCTION IsStatusChangeAllowed();
