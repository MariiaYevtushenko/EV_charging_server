/**
 * Перевірка Prisma: одна станція з портами та типами конекторів.
 * Запуск: `npx tsx scripts/test-station-find.ts`
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../generated/prisma/index.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const r = await prisma.station.findMany({
      take: 1,
      include: {
        ports: {
          include: { connectorType: true },
          orderBy: { portNumber: "asc" },
        },
      },
    });
    console.log("ok ports only", JSON.stringify(r, null, 2));
  } catch (e) {
    console.error("error", e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
