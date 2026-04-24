-- Дозволити NULL у payment_method для рахунків зі статусом PENDING (спосіб обирається при оплаті).
ALTER TABLE bill
  ALTER COLUMN payment_method DROP NOT NULL;
