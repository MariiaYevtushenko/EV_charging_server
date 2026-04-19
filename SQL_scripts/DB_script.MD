**Таблиці**

- `ev_user`  + рандомно SQL
- `location` csv ev_stations_2025.csv
- `station` csv ev_stations_2025.csv
- `connector_type` csv ev_stations_2025.csv
- `port` + csv ev_stations_2025.csv
- `vehicle` + csv file  "electric_vehicles_spec_2025.csv.csv",
- `tariff` - бере з апішки 
- `booking` — демо: `db/Seed_demo_bookings_sessions_bills.sql` → `SeedBookings(n)` або повний пайплайн `SeedBookingsSessionsBills(n)` (після CSV/тарифів)
- `session` — `SeedSessions(clear, target_count)` (після booking): ~50% без `booking_id`, ~50% за минулими бронями (не `CANCELLED` / не `NO_ACTION`); `start_time`/`end_time` узгоджені з бронюванням або задані для walk-in
- `bill` — `SeedBills()` (після session)
- `tariff_prediction` - буде в процесі 
- `forecast_bias` - буде в процесі

---

CREATE TYPE user_role AS ENUM ('ADMIN', 'STATION_ADMIN', 'USER');
CREATE TYPE station_status AS ENUM ('WORK', 'NO_CONNECTION', 'FIX', 'ARCHIVED');
CREATE TYPE port_status AS ENUM ('FREE', 'BOOKED', 'USED', 'REPAIRED');
CREATE TYPE tariff_period AS ENUM ('DAY', 'NIGHT');
CREATE TYPE booking_status AS ENUM ('BOOKED', 'NO_ACTION', 'CANCELLED', 'COMPLETED');
CREATE TYPE booking_type AS ENUM ('CALC', 'DEPOSIT');
CREATE TYPE session_status AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED');
CREATE TYPE payment_method AS ENUM ('CARD', 'APPLE_PAY', 'GOOGLE_PAY');
CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- додати в бд перевірку на імейл та номер телефону(символи)
CREATE TABLE IF NOT EXISTS ev_user(
id SERIAL PRIMARY KEY,
name VARCHAR(50) NOT NULL,
surname VARCHAR(50) NOT NULL,
email VARCHAR(254) UNIQUE NOT NULL,
phone_number VARCHAR(15) NOT NULL,
password_hash VARCHAR(254) NOT NULL,
role user_role DEFAULT 'USER',
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location(
id SERIAL PRIMARY KEY,
coordinates POINT NOT NULL,
country VARCHAR(100) NOT NULL,
city VARCHAR(100) NOT NULL,
street VARCHAR(100) NOT NULL,
house_number VARCHAR(10) NOT NULL
);


-- подумати над ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS station (
id SERIAL PRIMARY KEY,
location_id INT NOT NULL REFERENCES location(id) ON DELETE CASCADE,
name VARCHAR(100) NOT NULL,
status station_status DEFAULT 'WORK',
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connector_type (
id SERIAL PRIMARY KEY,
name VARCHAR(64) UNIQUE NOT NULL
);



CREATE TABLE IF NOT EXISTS port (
    station_id INT REFERENCES station(id) ON DELETE CASCADE,
    port_number INT NOT NULL CHECK (port_number > 0),
    max_power DECIMAL(5,2) NOT NULL,
    connector_type_id INT REFERENCES connector_type(id),
    status port_status DEFAULT 'FREE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (station_id, port_number)
);


id - ідентифікатор
license_plate - номерні знаки
battery_capacity - ємність батареї (кВт·год)

-- +
CREATE TABLE IF NOT EXISTS vehicle (
id SERIAL PRIMARY KEY,
user_id INT NOT NULL REFERENCES ev_user(id) ON DELETE CASCADE,
license_plate VARCHAR(20) UNIQUE NOT NULL,
brand VARCHAR(50) NOT NULL,
model VARCHAR(50) NOT NULL,
battery_capacity DECIMAL(5,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS tariff (
    id SERIAL PRIMARY KEY,
    tariff_type tariff_period NOT NULL, -- DAY/NIGHT
    price_per_kwh DECIMAL(10,2) NOT NULL,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tariff_type, effective_date)
);



CREATE TABLE IF NOT EXISTS booking (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES ev_user(id),
    vehicle_id INT REFERENCES vehicle(id),
    station_id INT NOT NULL,
    port_number INT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status booking_status DEFAULT 'BOOKED',
    booking_type booking_type DEFAULT 'CALC',
    prepayment_amount DECIMAL(10,2) DEFAULT 0, -- депозит або прорахована сума (прогноз)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (station_id, port_number) REFERENCES port(station_id, port_number)
);



CREATE TABLE IF NOT EXISTS session(
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES ev_user(id),
    vehicle_id INT REFERENCES vehicle(id),
    station_id INT NOT NULL,
    port_number INT NOT NULL,
    booking_id INT REFERENCES booking(id), -- NULL = сесія без попереднього бронювання (walk-in)
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- при наявному booking_id: у межах [booking.start_time, booking.end_time] (див. seed)
    end_time TIMESTAMP, -- NULL лише для ACTIVE; для завершених сесій > start_time
    kwh_consumed DECIMAL(10,3) DEFAULT 0,
    status session_status DEFAULT 'ACTIVE',
    FOREIGN KEY (station_id, port_number) REFERENCES port(station_id, port_number)
);



CREATE TABLE IF NOT EXISTS bill (
    id SERIAL PRIMARY KEY,
    session_id INT UNIQUE NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    calculated_amount DECIMAL(10,2) NOT NULL, 
    price_per_kwh_at_time DECIMAL(10,2), 
    payment_method payment_method NOT NULL,
    payment_status payment_status DEFAULT 'PENDING',
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



CREATE TABLE IF NOT EXISTS tariff_prediction (
    id SERIAL PRIMARY KEY,
    target_date DATE NOT NULL,
    tariff_type tariff_period NOT NULL,
    predicted_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (target_date, tariff_type)
);



CREATE TABLE IF NOT EXISTS forecast_bias (
    id SERIAL PRIMARY KEY,
    tariff_type tariff_period NOT NULL UNIQUE,
    bias_value DECIMAL(10, 4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



INSERT INTO forecast_bias (tariff_type, bias_value) VALUES ('DAY', 0), ('NIGHT', 0)
ON CONFLICT (tariff_type) DO NOTHING;


