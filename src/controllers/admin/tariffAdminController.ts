import type { RequestHandler } from "express";
import * as tariffAdminService from "../../services/admin/tariffAdminService.js";

export const getTariffsList: RequestHandler = async (_req, res, next) => {
  try {
    const data = await tariffAdminService.listTariffs();
    res.json(data);
  } catch (e) {
    next(e);
  }
};

export const getTariffsToday: RequestHandler = async (_req, res, next) => {
  try {
    const data = await tariffAdminService.getTodayTariffs();
    res.json(data);
  } catch (e) {
    next(e);
  }
};

/** Оновити з API лише денний або лише нічний тариф на сьогодні: body `{ "period": "day" | "night" }`. */
export const postTariffsTodayRefresh: RequestHandler = async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const p = b["period"];
    if (p !== "day" && p !== "night") {
      res.status(400).json({
        error: "Bad Request",
        message: 'Очікується period: "day" або "night".',
      });
      return;
    }
    const data = await tariffAdminService.refreshTodayTariffPeriodFromApi(p);
    res.json(data);
  } catch (e) {
    next(e);
  }
};

export const postTariffsSyncMissing: RequestHandler = async (_req, res, next) => {
  try {
    const data = await tariffAdminService.syncMissingTariffDaysToToday();
    res.json(data);
  } catch (e) {
    next(e);
  }
};

export const putTariffsToday: RequestHandler = async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const day = typeof b["dayPrice"] === "number" ? b["dayPrice"] : Number(b["dayPrice"]);
    const night =
      typeof b["nightPrice"] === "number" ? b["nightPrice"] : Number(b["nightPrice"]);
    if (!Number.isFinite(day) || !Number.isFinite(night)) {
      res.status(400).json({
        error: "Bad Request",
        message: "Очікується dayPrice та nightPrice (числа).",
      });
      return;
    }
    const data = await tariffAdminService.putTodayTariffs(day, night);
    res.json(data);
  } catch (e) {
    next(e);
  }
};
