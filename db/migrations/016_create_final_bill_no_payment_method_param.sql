-- CreateFinalBill: без параметра payment_method (у bill завжди NULL до ProcessPayment).
-- Оновити процедуру та тригерну функцію для існуючих БД після 013.

CREATE OR REPLACE PROCEDURE CreateFinalBill(
  p_session_id INT,
  p_payment_status payment_status
)
LANGUAGE plpgsql AS $$
DECLARE
  v_final_price DECIMAL(10, 2);
  v_tariff_price DECIMAL(10, 2);
BEGIN

  IF NOT EXISTS (
    SELECT 1
    FROM session
    WHERE id = p_session_id AND status = 'COMPLETED'::session_status)
  THEN
    RAISE EXCEPTION 'Сесія не знайдена або вже завершена';
    RETURN;
  END IF;

  SELECT calculated_amount, price_per_kwh
  INTO STRICT v_final_price, v_tariff_price
  FROM GetFinalSessionAmount(p_session_id);

  INSERT INTO bill (session_id, calculated_amount, price_per_kwh_at_time, payment_method, payment_status)
  VALUES (p_session_id, v_final_price, v_tariff_price, NULL, p_payment_status)
  ON CONFLICT (session_id) DO UPDATE SET
    calculated_amount = EXCLUDED.calculated_amount,
    price_per_kwh_at_time = EXCLUDED.price_per_kwh_at_time,
    payment_method = EXCLUDED.payment_method,
    payment_status = EXCLUDED.payment_status;
END;
$$;

CREATE OR REPLACE FUNCTION SessionCompletedFinalizeBill()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'COMPLETED'::session_status
       AND OLD.status = 'ACTIVE'::session_status THEN
        CALL CreateFinalBill(NEW.id, 'PENDING'::payment_status);

        UPDATE port
        SET
            status = 'FREE'::port_status,
            updated_at = CURRENT_TIMESTAMP
        WHERE station_id = NEW.station_id
          AND port_number = NEW.port_number
          AND status = 'USED'::port_status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
