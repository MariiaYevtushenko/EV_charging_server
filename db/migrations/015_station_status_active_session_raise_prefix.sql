-- Префікс STATION_ACTIVE_SESSION у RAISE — стабільно розпізнається в обгортці Prisma (PUT / транзакції).
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
