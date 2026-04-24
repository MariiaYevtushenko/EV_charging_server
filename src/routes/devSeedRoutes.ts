import { Router, type RequestHandler } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runForecastModelOnce } from "../services/forecast/forecastScheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..", "..");

/** Один раз за процес Node після успішного SEED — спільно для всіх клієнтів. */
let seedAlreadyRunThisProcess = false;
/** Триває фоновий `seed-all-data` (відповідь HTTP уже відправлена — проксі не чекає). */
let seedRunInProgress = false;
let seedLastError: string | null = null;

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
    inProgress: seedRunInProgress,
    lastError: seedLastError,
  });
});

devSeedRouter.post("/seed-from-csv", requireDevSeed, (_req, res) => {
  if (seedAlreadyRunThisProcess) {
    res.status(409).json({
      error: "already_run",
      message:
        "За цей запуск сервера демо-дані вже завантажувалися. Перезапустіть API, щоб спробувати знову.",
    });
    return;
  }
  if (seedRunInProgress) {
    res.status(409).json({
      error: "in_progress",
      message:
        "Заповнення БД уже виконується на сервері. Дочекайтесь завершення або перегляньте лог API.",
    });
    return;
  }

  seedRunInProgress = true;
  seedLastError = null;

  res.status(202).json({
    ok: true,
    accepted: true,
    message:
      "Заповнення БД запущено на сервері. Ця сторінка оновить статус після завершення (HTTP-з’єднання не тримається відкритим — проксі не має давати 502).",
  });

  void runSeedScript()
    .then(() => {
      seedAlreadyRunThisProcess = true;
      seedRunInProgress = false;
      seedLastError = null;
      void runForecastModelOnce("після dev SEED (seed-all-data)");
    })
    .catch((e) => {
      seedRunInProgress = false;
      seedLastError =
        e instanceof Error ? e.message : "Невідома помилка під час SEED";
    });
});
