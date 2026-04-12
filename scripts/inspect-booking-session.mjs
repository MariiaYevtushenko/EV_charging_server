import "dotenv/config";
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
for (const t of ["booking", "session"]) {
  const r = await c.query(
    `SELECT column_name, is_nullable, data_type FROM information_schema.columns 
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t]
  );
  console.log("\n===", t, "===");
  console.table(r.rows);
}
await c.end();
