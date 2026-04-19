
-- -----------------------------------------------------------------------------
-- GetFinalSessionAmount — сума до сплати та ціна kВт·год для сесії
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION GetFinalSessionAmount(p_session_id INT)
RETURNS TABLE(calculated_amount DECIMAL(10, 2), price_per_kwh DECIMAL(10, 2)) AS $$
DECLARE
  v_booking_id INT;
  v_booking_type booking_type;
  v_prepayment DECIMAL(10, 2);
  v_kwh_consumed DECIMAL(10, 3);
  v_tariff_price DECIMAL(10, 2);
  v_start_time TIMESTAMP;
  v_tariff_type tariff_period;
  v_final DECIMAL(10, 2);
  v_session_id INT;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Сесія не може бути NULL';
  END IF;

  SELECT s.id, s.booking_id, s.kwh_consumed, s.start_time
  INTO v_session_id, v_booking_id, v_kwh_consumed, v_start_time
  FROM session s
  WHERE s.id = p_session_id;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Сесія не знайдена';
  END IF;

  SELECT b.prepayment_amount, b.booking_type
  INTO v_prepayment, v_booking_type
  FROM booking b
  WHERE b.id = v_booking_id;

  IF v_booking_type IS NOT NULL AND v_booking_type = 'CALC'::booking_type THEN
    v_tariff_price := v_prepayment;
   
  ELSE
    v_tariff_type := GetTariffType(v_start_time);
    v_tariff_price := GetTariffPricePerKwhAt(v_start_time, v_tariff_type);
    IF v_booking_id IS NOT NULL THEN
       v_prepayment := v_prepayment;    
    END IF;
  END IF;

  v_final := ROUND((v_kwh_consumed * v_tariff_price) + COALESCE(v_prepayment, 0), 2);

  RETURN QUERY SELECT v_final, v_tariff_price;
END;
$$ LANGUAGE plpgsql;
