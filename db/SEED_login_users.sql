
-- Демо-акаунти для входу в додаток
INSERT INTO ev_user (name, surname, email, phone_number, password_hash, role) VALUES
  ('Олександр', 'Адмін', 'admin@test.com', '+380671110001', 'password', 'ADMIN'),
  ('Дмитро', 'Менеджер', 'station_admin@test.com', '+380671110002', 'password', 'STATION_ADMIN'),
  ('Іван', 'Петренко', 'user@test.com', '+380502220001', 'password', 'USER')
ON CONFLICT (email) DO NOTHING;