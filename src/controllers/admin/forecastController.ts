import type { RequestHandler } from "express";
import { ingestDailyTariff } from "../../services/forecast/tariffIngestService.js";
import { runAiEngine } from "../../services/forecast/forecastRunner.js";
import { listTariffPredictionsForAdmin } from "../../services/forecast/forecastPredictionsAdminService.js";

/** POST /api/admin/forecast/ingest-tariff — зберегти денні тарифи (cron / ручний). */
export const postIngestTariff: RequestHandler = async (_req, res, next) => {
  try {
    const result = await ingestDailyTariff(new Date());
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
};

/** POST /api/admin/forecast/run-model — Python SARIMA → tariff_prediction. */
export const postRunForecastModel: RequestHandler = async (_req, res, next) => {
  try {
    const { code, stdout, stderr } = await runAiEngine();
    if (code !== 0) {
      const hint = (stderr ?? stdout ?? "").trim().slice(0, 600);
      /** Префікс з кирилицею — інакше клієнт для 500 ховає технічний текст без UA. */
      const message = hint
        ? `Помилка моделі прогнозу: ${hint}`
        : `Модель прогнозу завершилась з кодом ${code}. Перевірте PYTHON_PATH або py/python у PATH, DATABASE_URL та наявність рядків у tariff.`;
      res.status(500).json({
        ok: false,
        code,
        stdout,
        stderr,
        message,
      });
      return;
    }
    res.json({ ok: true, stdout, stderr });
  } catch (e) {
    next(e);
  }
};

/** GET /api/admin/forecast/predictions?days=21 — серія прогнозованих цін (tariff_prediction). */
export const getForecastPredictions: RequestHandler = async (req, res, next) => {
  try {
    const raw = req.query["days"];
    let days = 21;
    if (raw !== undefined) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 1 && n <= 90) {
        days = Math.floor(n);
      }
    }
    const data = await listTariffPredictionsForAdmin(days);
    res.json(data);
  } catch (e) {
    next(e);
  }
};
