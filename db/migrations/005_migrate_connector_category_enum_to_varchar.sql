-- One-time migration: replace PostgreSQL enum `connector_category` with VARCHAR on `connector_type.name`.
-- Run only if the database was created with `CREATE TYPE connector_category ...` and `name connector_category`.
-- Skip on fresh installs that use EV_Charging_DB.sql without the enum.

ALTER TABLE connector_type
  ALTER COLUMN name TYPE VARCHAR(64) USING name::text;

DROP TYPE IF EXISTS connector_category;
