import type { RequestHandler } from "express";
import { ingestDailyTariff } from "../../services/forecast/tariffIngestService.js";
import { runAiEngine, runUpdateBias } from "../../services/forecast/forecastRunner.js";

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
      res.status(500).json({ ok: false, code, stdout, stderr });
      return;
    }
    res.json({ ok: true, stdout, stderr });
  } catch (e) {
    next(e);
  }
};

/** POST /api/admin/forecast/update-bias — self-learning по bill vs prepayment. */
export const postUpdateBias: RequestHandler = async (_req, res, next) => {
  try {
    const { code, stdout, stderr } = await runUpdateBias();
    if (code !== 0) {
      res.status(500).json({ ok: false, code, stdout, stderr });
      return;
    }
    res.json({ ok: true, stdout, stderr });
  } catch (e) {
    next(e);
  }
};
