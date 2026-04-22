import prisma from "../prisma.config.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import { TariffPeriod } from "../../generated/prisma/index.js";
import {
  DEFAULT_DAY_FALLBACK,
  DEFAULT_NIGHT_FALLBACK,
} from "../utils/tariffEnv.js";
import { localDateAtNoon } from "../utils/tariffDateUtils.js";
import {
  sanitizeTariffDayNightUah,
  sanitizeTariffSingleUah,
} from "../utils/tariffPriceSanitize.js";

const db = prisma as unknown as PrismaClient;

export type TariffRow = Awaited<ReturnType<typeof db.tariff.findMany>>[number];

export const tariffRepository = {
  async listAll(take = 3000) {
    return db.tariff.findMany({
      orderBy: [{ effectiveDate: "desc" }, { tariffType: "asc" }],
      take,
    });
  },

  async findForCalendarDay(calendarDay: Date) {
    const effectiveDate = localDateAtNoon(calendarDay);
    return db.tariff.findMany({
      where: { effectiveDate },
    });
  },

  /** Найпізніша календарна дата серед усіх рядків тарифу (DAY/NIGHT мають однакову дату). */
  async maxEffectiveDate(): Promise<Date | null> {
    const agg = await db.tariff.aggregate({
      _max: { effectiveDate: true },
    });
    return agg._max.effectiveDate;
  },

  /**
   * Upsert двох рядків tariff (DAY і NIGHT) на одну календарну дату.
   */
  async upsertDayNightForCalendarDay(
    calendarDay: Date,
    dayPricePerKwh: number,
    nightPricePerKwh: number
  ): Promise<void> {
    const s = sanitizeTariffDayNightUah(dayPricePerKwh, nightPricePerKwh);
    const effectiveDate = localDateAtNoon(calendarDay);
    await db.tariff.upsert({
      where: {
        tariffType_effectiveDate: {
          tariffType: TariffPeriod.DAY,
          effectiveDate,
        },
      },
      create: {
        tariffType: TariffPeriod.DAY,
        pricePerKwh: s.day,
        effectiveDate,
      },
      update: { pricePerKwh: s.day },
    });
    await db.tariff.upsert({
      where: {
        tariffType_effectiveDate: {
          tariffType: TariffPeriod.NIGHT,
          effectiveDate,
        },
      },
      create: {
        tariffType: TariffPeriod.NIGHT,
        pricePerKwh: s.night,
        effectiveDate,
      },
      update: { pricePerKwh: s.night },
    });
  },

  /** Один рядок (DAY або NIGHT) на календарну дату — інший період не змінюється. */
  async upsertTariffPeriodForCalendarDay(
    calendarDay: Date,
    tariffType: TariffPeriod,
    pricePerKwh: number
  ): Promise<void> {
    const fb =
      tariffType === TariffPeriod.DAY
        ? DEFAULT_DAY_FALLBACK
        : DEFAULT_NIGHT_FALLBACK;
    const p = sanitizeTariffSingleUah(pricePerKwh, fb);
    const effectiveDate = localDateAtNoon(calendarDay);
    await db.tariff.upsert({
      where: {
        tariffType_effectiveDate: {
          tariffType,
          effectiveDate,
        },
      },
      create: {
        tariffType,
        pricePerKwh: p,
        effectiveDate,
      },
      update: { pricePerKwh: p },
    });
  },
};
