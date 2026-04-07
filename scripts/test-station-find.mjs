import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../generated/prisma/index.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
