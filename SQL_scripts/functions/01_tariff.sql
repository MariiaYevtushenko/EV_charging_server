-- Пакет: тарифні інструменти (лише читання з tariff / обчислення періоду)
-- Залежності: таблиця tariff, типи tariff_period

-- -----------------------------------------------------------------------------
-- GetTariffPricePerKwhAt — актуальна ціна кВт·год для типу періоду на дату
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetTariffPricePerKwhAt(p_at TIMESTAMP, p_tariff_type tariff_period)
RETURNS DECIMAL(10, 2) AS $$
DECLARE
  v_day DATE;
  v_price DECIMAL(10, 2);
BEGIN
  v_day := (p_at)::date;

  SELECT t.price_per_kwh
  INTO v_price
  FROM tariff t
  WHERE t.tariff_type = p_tariff_type AND t.effective_date <= v_day
  ORDER BY t.effective_date DESC
  LIMIT 1;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Не знайдено тарифу на дату %', v_day;
  END IF;

  RETURN v_price;
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- GetTariffType — денний / нічний тариф за годиною (07:00–23:00 / решта)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetTariffType(p_time TIMESTAMP)
RETURNS tariff_period AS $$
DECLARE
  v_t TIME;
BEGIN
  v_t := (p_time)::time;

  IF v_t >= time '07:00' AND v_t < time '23:00' THEN
    RETURN 'DAY'::tariff_period;
  END IF;
  RETURN 'NIGHT'::tariff_period;
END;
$$ LANGUAGE plpgsql STABLE;
