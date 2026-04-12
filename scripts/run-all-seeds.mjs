/**
 * Зворотна сумісність: той самий пайплайн, що й seed-all-data.mjs (див. SEED_ALL_DATA).
 */
import { SeedAllData } from "./seed-all-data.mjs";

const truncate = process.argv.slice(2).includes("--truncate");

SeedAllData({ truncate }).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
