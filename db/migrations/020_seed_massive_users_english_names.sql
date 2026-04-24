-- Оновлення демо-імен/прізвищ у SeedMassiveUsers (англійська мова); узгоджено з db/DB_CODE_SQL/SeedData.sql.
-- Потребує наявної функції GeneratePassword (див. той самий SeedData.sql).
CREATE OR REPLACE PROCEDURE SeedMassiveUsers(p_count INT DEFAULT 1000)
LANGUAGE plpgsql
AS $$
DECLARE
  first_names TEXT[] := ARRAY[
    'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
    'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua',
    'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob',
    'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin',
    'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Margaret', 'Dorothy', 'Lisa'
  ];
  last_names TEXT[] := ARRAY[
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thompson',
    'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'White', 'Harris',
    'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen',
    'King', 'Wright', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams',
    'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
    'Gomez', 'Phillips', 'Evans', 'Turner', 'Parker', 'Collins', 'Edwards', 'Stewart'
  ];
  email_domains TEXT[] := ARRAY[
    'gmail.com', 'ukr.net', 'i.ua', 'meta.ua', 'bigmir.net', 'outlook.com', 'yahoo.com', 'proton.me', 'ev-charge.com'
  ];
  mobile_prefixes TEXT[] := ARRAY[
    '50', '66', '95', '99', '67', '68', '97', '98', '63', '73', '93'
  ];
  v_name TEXT;
  v_surname TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_role user_role;
  v_random_num INT;
  v_password TEXT;
  first_names_len INT;
  last_names_len INT;
BEGIN
  first_names_len := array_length(first_names, 1);
  last_names_len := array_length(last_names, 1);

  -- Вставка випадкових користувачів 
  FOR i IN 1..p_count LOOP

    v_name := first_names[1 + floor(random() * first_names_len)::int];
    v_surname := last_names[1 + floor(random() * last_names_len)::int];

    v_random_num := floor(random() * 999)::int;
    v_email := lower(v_name) || '.' || i::text || v_random_num::text || '.' || lower(v_surname) || '@' ||
      email_domains[1 + floor(random() * array_length(email_domains, 1))::int];
      
    v_phone := '+380' ||
      mobile_prefixes[1 + floor(random() * array_length(mobile_prefixes, 1))::int] || (1000000 + floor(random() * 8999999))::text;
   
    IF random() < 0.05 THEN
      v_role := 'STATION_ADMIN';
    ELSE
      v_role := 'USER';
    END IF;

    v_password := GeneratePassword(12);

    INSERT INTO ev_user (name, surname, email, phone_number, password_hash, role, created_at)
    VALUES (v_name, v_surname, v_email, v_phone, v_password, v_role, NOW() - (random() * INTERVAL '365 days'))
    ON CONFLICT (email) DO NOTHING;

  END LOOP;

  RAISE NOTICE 'SeedMassiveUsers: додано до % облікових записів', p_count;
END;
$$;
