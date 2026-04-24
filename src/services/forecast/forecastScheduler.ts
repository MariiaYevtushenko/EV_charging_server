import prisma from "../../prisma.config.js";
import { runAiEngine } from "./forecastRunner.js";

let intervalHandle: ReturnType<typeof setInterval> | undefined;
let runLock = false;

async function hasTariffRowsForForecast(): Promise<boolean> {
  const n = await prisma.tariff.count();
  return n > 0;
}

/**
 * Запуск Python `forecast/ai_engine.py` (SARIMA → tariff_prediction).
 * Не кидає вгору — лише логує (щоб падіння Python не валило API).
 * Без рядків у `tariff` прогноз не запускається (історія для SARIMA відсутня).
 */
export async function runForecastModelOnce(source: string): Promise<void> {
  try {
    if (!(await hasTariffRowsForForecast())) {
      console.warn(
        `[forecast] неможливо сформувати прогноз (${source}): відсутні дані в таблиці tariff`,
      );
      return;
    }
  } catch (e) {
    console.error(`[forecast] перевірка tariff не вдалася (${source})`, e);
    return;
  }

  if (runLock) {
    console.warn(`[forecast] skip (${source}): попередній запуск ще виконується`);
    return;
  }
  runLock = true;
  try {
    const { code, stdout, stderr } = await runAiEngine();
    if (code !== 0) {
      const winPyHint =
        code === 9009 && process.platform === "win32"
          ? " — Windows: не знайдено команду запуску Python. Задайте PYTHON_PATH (повний шлях до python.exe) або переконайтеся, що в PATH є `py` (Python Launcher) / `python`."
          : "";
      console.error(
        `[forecast] ai_engine.py помилка (${source}) exit=${code}${winPyHint}`,
        stderr?.trim() || stdout?.trim() || "",
      );
      return;
    }
    const preview = stdout?.trim().slice(0, 280) ?? "";
    console.log(`[forecast] ai_engine.py ок (${source})${preview ? ` ${preview}` : ""}`);
  } catch (e) {
    console.error(`[forecast] ai_engine.py виняток (${source})`, e);
  } finally {
    runLock = false;
  }
}

function envFlag(name: string, defaultTrue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultTrue;
  const s = v.toLowerCase();
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  return defaultTrue;
}

function intervalMsFromEnv(): number {
  const hoursRaw = process.env["FORECAST_INTERVAL_HOURS"];
  const h = hoursRaw !== undefined && hoursRaw !== "" ? Number(hoursRaw) : 24;
  if (Number.isFinite(h) && h > 0) {
    return Math.floor(h * 60 * 60 * 1000);
  }
  return 24 * 60 * 60 * 1000;
}

const START_DELAY_MS = (() => {
  const s = Number(process.env["FORECAST_START_DELAY_SEC"] ?? "5");
  if (Number.isFinite(s) && s >= 0 && s <= 300) return Math.floor(s * 1000);
  return 5000;
})();

/**
 * Автозапуск моделі прогнозу тарифів разом із сервером і за таймером.
 *
 * Перед кожним запуском перевіряється таблиця `tariff`: якщо порожня — Python не викликається,
 * у лог пишеться, що неможливо сформувати прогноз (немає даних).
 *
 * - `FORECAST_AUTO_RUN=false` — вимкнути все
 * - `FORECAST_RUN_ON_START=false` — не запускати одразу після старту (лише інтервал)
 * - `FORECAST_INTERVAL_HOURS` — період повтору (за замовчуванням 24 = щодня оновлення прогнозу в БД)
 * - `FORECAST_START_DELAY_SEC` — затримка першого запуску після listen (сек, за замовч. 5)
 */
export function startForecastModelScheduler(): void {
  if (!envFlag("FORECAST_AUTO_RUN", true)) {
    console.log("[forecast] автозапуск вимкнено (FORECAST_AUTO_RUN=false)");
    return;
  }

  const onStart = envFlag("FORECAST_RUN_ON_START", true);
  const everyMs = intervalMsFromEnv();
  const hoursLabel = everyMs / (60 * 60 * 1000);

  if (onStart) {
    setTimeout(() => {
      void runForecastModelOnce("старт сервера");
    }, START_DELAY_MS);
  }

  intervalHandle = setInterval(() => {
    void runForecastModelOnce(`інтервал ${hoursLabel} год`);
  }, everyMs);

  console.log(
    `[forecast] планувальник: перший запуск через ${START_DELAY_MS / 1000} с (якщо увімкнено), далі кожні ${hoursLabel} год`
  );
}

export function stopForecastModelScheduler(): void {
  if (intervalHandle !== undefined) {
    clearInterval(intervalHandle);
    intervalHandle = undefined;
  }
}
