/**
 * Зворотна сумісність: запускає `seed-all-data.ts` через tsx.
 * Використання: `npx tsx scripts/seed-all-data.launch.ts [аргументи як у seed-all-data.ts]`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");
const tsxCli = path.join(SERVER_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const script = path.join(__dirname, "seed-all-data.ts");

if (!fs.existsSync(tsxCli)) {
  console.error("[ERROR] tsx not found. Run: npm install (in server/)");
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, script, ...process.argv.slice(2)], {
  cwd: SERVER_ROOT,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("error", (err: Error) => {
  console.error(err);
  process.exitCode = 1;
});

child.on("close", (code: number | null) => {
  process.exit(code ?? 1);
});
