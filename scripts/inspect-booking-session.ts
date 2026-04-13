/**
 * Друк колонок `information_schema` для таблиць booking та session.
 * Запуск: `npx tsx scripts/inspect-booking-session.ts`
 */
import "dotenv/config";
import pg from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const c = new pg.Client({ connectionString: url });
  await c.connect();

  try {
    for (const t of ["booking", "session"] as const) {
      const r = await c.query<{
        column_name: string;
        is_nullable: string;
        data_type: string;
      }>(
        `SELECT column_name, is_nullable, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [t],
      );
      console.log("\n===", t, "===");
      console.table(r.rows);
    }
  } finally {
    await c.end();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
