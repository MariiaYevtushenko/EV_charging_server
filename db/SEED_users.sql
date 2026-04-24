-- Генерація випадкового пароля
CREATE OR REPLACE FUNCTION GeneratePassword(p_len INT DEFAULT 12)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_=+';
  result TEXT := '';
  clen INT;
  i INT;
  pos INT;
BEGIN
  IF p_len IS NULL OR p_len < 8 THEN
    p_len := 12;
  END IF;
  clen := length(chars);
  FOR i IN 1..p_len LOOP
    pos := 1 + floor(random() * clen)::int;
    result := result || substr(chars, pos, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Створення випадкових користувачів
CREATE OR REPLACE PROCEDURE SeedMassiveUsers(p_count INT DEFAULT 1000)
LANGUAGE plpgsql
AS $$
DECLARE
  first_names TEXT[] := ARRAY[
    'Олександр', 'Андрій', 'Максим', 'Дмитро', 'Іван', 'Віктор', 'Юрій', 'Сергій', 'Роман', 'Богдан',
    'Михайло', 'Василь', 'Петро', 'Олег', 'Артем', 'Тарас', 'Кирило', 'Ігор', 'Володимир', 'Назар',
    'Євген', 'Степан', 'Марко', 'Леонід', 'Вадим', 'Руслан', 'Павло', 'Тимофій', 'Микола', 'Станіслав',
    'Олена', 'Марія', 'Анна', 'Катерина', 'Наталія', 'Юлія', 'Тетяна', 'Ірина', 'Світлана', 'Оксана',
    'Христина', 'Вікторія', 'Дарина', 'Софія', 'Єлизавета', 'Марина', 'Людмила', 'Ганна', 'Зоряна', 'Аліна'
  ];
  last_names TEXT[] := ARRAY[
    'Петренко', 'Коваленко', 'Бондаренко', 'Шевченко', 'Ткаченко', 'Мельник', 'Кравченко', 'Поліщук',
    'Сидоренко', 'Романенко', 'Лисенко', 'Мороз', 'Коваль', 'Павлюк', 'Іваненко', 'Гончар', 'Олійник',
    'Дорошенко', 'Савчук', 'Костюк', 'Зінченко', 'Мазур', 'Левченко', 'Бойко', 'Ткачук', 'Гриценко',
    'Дудник', 'Руденко', 'Кучер', 'Пономаренко', 'Сердюк', 'Мартинюк', 'Яремчук', 'Вовк', 'Пилипенко',
    'Гаврилюк', 'Кравець', 'Шаповал', 'Литвин', 'Осадчук', 'Рябоконь', 'Стеценко', 'Федоренко', 'Чорненко',
    'Демченко', 'Білоус', 'Гордієнко', 'Коломієць', 'Лукашук', 'Назаренко', 'Паламарчук', 'Скрипник'
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
