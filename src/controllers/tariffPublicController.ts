import type { RequestHandler } from "express";
import { dateKeyLocal, localDateAtNoon } from "../utils/tariffDateUtils.js";
import { tariffRepository } from "../db/tariffRepository.js";

/** GET /api/stations/tariffs/today — денний/нічний тариф з таблиці `tariff` на поточний календарний день (грн/кВт·год). */
export const getPublicTodayTariffs: RequestHandler = async (_req, res, next) => {
  try {
    const today = new Date();
    const { dayPriceUah, nightPriceUah } = await tariffRepository.resolveEffectiveDayNightUah(today);
    res.json({
      date: dateKeyLocal(localDateAtNoon(today)),
      dayPriceUah,
      nightPriceUah,
    });
  } catch (e) {
    next(e);
  }
};
