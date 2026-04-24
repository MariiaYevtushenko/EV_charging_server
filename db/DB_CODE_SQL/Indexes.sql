
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session (user_id);

CREATE INDEX IF NOT EXISTS idx_booking_user_id ON booking (user_id);

-- Для пошуку чаосиз перетинів
CREATE INDEX IF NOT EXISTS idx_booking_time ON booking (start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_booking_station_port_booked
  ON booking (station_id, port_number)
  WHERE status = 'BOOKED'::booking_status;

-- Для карти 
CREATE INDEX IF NOT EXISTS idx_location_point_components
  ON location (((coordinates)[0]::double precision), ((coordinates)[1]::double precision));
