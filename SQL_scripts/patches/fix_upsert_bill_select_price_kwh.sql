-- Виправлення: UpsertBillForSession звертався до неіснуючої колонки price_per_kwh_at_time
-- у результаті GetFinalSessionAmount (там повертається price_per_kwh).
-- Застосуйте на існуючій БД: psql $DATABASE_URL -f server/SQL_scripts/patches/fix_upsert_bill_select_price_kwh.sql

CREATE OR REPLACE FUNCTION UpsertBillForSession(
  p_session_id INT,
  p_payment_method payment_method,
  p_payment_status payment_status
)
RETURNS VOID AS $$
DECLARE
  v_final_price DECIMAL(10, 2);
  v_tariff_price DECIMAL(10, 2);
BEGIN
  SELECT calculated_amount, price_per_kwh
  INTO v_final_price, v_tariff_price
  FROM GetFinalSessionAmount(p_session_id);

  INSERT INTO bill (session_id, calculated_amount, price_per_kwh_at_time, payment_method, payment_status)
  VALUES (p_session_id, v_final_price, v_tariff_price, p_payment_method, p_payment_status)
  ON CONFLICT (session_id) DO UPDATE SET
    calculated_amount = EXCLUDED.calculated_amount,
    price_per_kwh_at_time = EXCLUDED.price_per_kwh_at_time,
    payment_method = EXCLUDED.payment_method,
    payment_status = EXCLUDED.payment_status;
END;
$$ LANGUAGE plpgsql;
