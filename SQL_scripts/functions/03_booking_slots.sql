-- Пакет: бронювання — пошук вільних слотів (лише читання)
-- Залежності: таблиця booking

-- -----------------------------------------------------------------------------
-- GetAvailableBookingSlots — вільні інтервали на порту за днем
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetAvailableBookingSlots(
  p_station_id INT,
  p_port_number INT,
  p_date DATE,
  p_slot_size_minutes INTERVAL,
  p_units INT
)
RETURNS TABLE(available_start TIMESTAMP, available_end TIMESTAMP) AS $$
DECLARE
  v_total_duration INTERVAL := (p_slot_size_minutes * p_units) * interval '1 minute';
  v_step INTERVAL := p_slot_size_minutes * interval '1 minute';
BEGIN
  RETURN QUERY
  WITH FreeSlotsStarts AS (
    SELECT generate_series(
      p_date::timestamp,
      (p_date + interval '1 day' - v_total_duration),
      v_step
    ) AS s_start
  )
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
