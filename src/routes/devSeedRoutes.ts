import { Router, type RequestHandler } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..", "..");

/** Один раз за процес Node — спільно для всіх клієнтів. */
let seedAlreadyRunThisProcess = false;

function runSeedScript(): Promise<void> {
  const script = path.join(SERVER_ROOT, "scripts", "seed-all-data.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: SERVER_ROOT,
      env: { ...process.env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`seed-all-data exited with code ${code}`));
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
        "Демо-дані (CSV станції, тарифи, SeedMassiveUsers, RandomizeAfterCsv) успішно завантажено.",
    });
  } catch (e) {
    next(e);
  }
});
