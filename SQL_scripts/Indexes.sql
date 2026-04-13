-- ІНДЕКСИ
-- Кабінет: «Мої бронювання» → GET .../bookings (findMany WHERE user_id)
CREATE INDEX IF NOT EXISTS index_BookingTime ON booking (start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_booking_user_id ON booking (user_id);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON session (user_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_user_id ON vehicle (user_id);

CREATE INDEX IF NOT EXISTS idx_booking_station_port_booked
  ON booking (station_id, port_number)
  WHERE status = 'BOOKED'::booking_status;

CREATE INDEX IF NOT EXISTS idx_location_coordinates
  ON location USING GIST (coordinates);
