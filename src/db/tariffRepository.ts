import prisma from "../prisma.config.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import { TariffPeriod } from "../../generated/prisma/index.js";
import { localDateAtNoon } from "../utils/tariffDateUtils.js";

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

  /**
   * Upsert двох рядків tariff (DAY і NIGHT) на одну календарну дату.
   */
  async upsertDayNightForCalendarDay(
    calendarDay: Date,
    dayPricePerKwh: number,
    nightPricePerKwh: number
  ): Promise<void> {
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
        pricePerKwh: dayPricePerKwh,
        effectiveDate,
      },
      update: { pricePerKwh: dayPricePerKwh },
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
        pricePerKwh: nightPricePerKwh,
        effectiveDate,
      },
      update: { pricePerKwh: nightPricePerKwh },
    });
  },
};
