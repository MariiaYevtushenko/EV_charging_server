import type { RequestHandler } from "express";
import { ingestDailyTariff } from "../../services/forecast/tariffIngestService.js";
import { runAiEngine, runUpdateBias } from "../../services/forecast/forecastRunner.js";
import {
  getForecastBiasForAdmin,
  setForecastBiasForAdmin,
} from "../../services/forecast/forecastBiasAdminService.js";

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

/** GET /api/admin/forecast/bias — поточні зміщення прогнозу (DAY/NIGHT). */
export const getForecastBias: RequestHandler = async (_req, res, next) => {
  try {
    const data = await getForecastBiasForAdmin();
    res.json(data);
  } catch (e) {
    next(e);
  }
};

/** PUT /api/admin/forecast/bias — оновити зміщення (тіло: { day?, night? }, грн/кВт·год). */
export const putForecastBias: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as { day?: unknown; night?: unknown };
    const patch: { day?: number; night?: number } = {};
    if (body.day !== undefined) {
      const d = Number(body.day);
      if (!Number.isFinite(d)) {
        res.status(400).json({ error: "Invalid day" });
        return;
      }
      patch.day = d;
    }
    if (body.night !== undefined) {
      const n = Number(body.night);
      if (!Number.isFinite(n)) {
        res.status(400).json({ error: "Invalid night" });
        return;
      }
      patch.night = n;
    }
    if (patch.day === undefined && patch.night === undefined) {
      res.status(400).json({ error: "Provide day and/or night" });
      return;
    }
    const data = await setForecastBiasForAdmin(patch);
    res.json(data);
  } catch (e) {
    next(e);
  }
};
