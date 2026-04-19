import { Router, type RequestHandler } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..", "..");

/** Один раз за процес Node — спільно для всіх клієнтів. */
let seedAlreadyRunThisProcess = false;

function runSeedScript(): Promise<void> {
  const tsxCli = path.join(SERVER_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(SERVER_ROOT, "scripts", "seed-all-data.ts");
  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    const child = spawn(process.execPath, [tsxCli, script], {
      cwd: SERVER_ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const combined = (stderr || stdout).trim();
        const tail = combined
          ? combined.split("\n").slice(-12).join("\n").trim()
          : "";
        reject(
          new Error(
            tail || `seed-all-data завершився з кодом ${code ?? "unknown"}`,
          ),
        );
      }
    });
  });
}

const requireDevSeed: RequestHandler = (req, res, next) => {
  if (process.env["ALLOW_DEV_SEED"] !== "true") {
    res.status(404).json({ error: "not_found", message: "Endpoint disabled" });
    return;
  }
  next();
};

export const devSeedRouter = Router();

devSeedRouter.get("/seed-from-csv/status", requireDevSeed, (_req, res) => {
  res.json({
    enabled: true,
    alreadyRun: seedAlreadyRunThisProcess,
  });
});

devSeedRouter.post("/seed-from-csv", requireDevSeed, async (_req, res, next) => {
  try {
    if (seedAlreadyRunThisProcess) {
      res.status(409).json({
        error: "already_run",
        message:
          "За цей запуск сервера демо-дані вже завантажувалися. Перезапустіть API, щоб спробувати знову.",
      });
      return;
    }
    await runSeedScript();
    seedAlreadyRunThisProcess = true;
    res.json({
      ok: true,
      message:
        "SEED успішно завершено",
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Невідома помилка під час SEED";
    res.status(500).json({
      ok: false,
      error: "seed_failed",
      message,
    });
  }
});
