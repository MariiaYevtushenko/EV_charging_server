import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import { TariffPeriod } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export type ForecastBiasAdminDto = {
  day: number;
  night: number;
  updatedAtDay: string | null;
  updatedAtNight: string | null;
};

export async function getForecastBiasForAdmin(): Promise<ForecastBiasAdminDto> {
  const rows = await db.forecastBias.findMany();
  const dayRow = rows.find((r) => r.tariffType === TariffPeriod.DAY);
  const nightRow = rows.find((r) => r.tariffType === TariffPeriod.NIGHT);
  return {
    day: dayRow ? Number(dayRow.biasValue) : 0,
    night: nightRow ? Number(nightRow.biasValue) : 0,
    updatedAtDay: dayRow?.updatedAt?.toISOString() ?? null,
    updatedAtNight: nightRow?.updatedAt?.toISOString() ?? null,
  };
}

export async function setForecastBiasForAdmin(patch: {
  day?: number;
  night?: number;
}): Promise<ForecastBiasAdminDto> {
  if (patch.day !== undefined) {
    await db.forecastBias.upsert({
      where: { tariffType: TariffPeriod.DAY },
      create: {
        tariffType: TariffPeriod.DAY,
        biasValue: patch.day,
      },
      update: { biasValue: patch.day },
    });
  }
  if (patch.night !== undefined) {
    await db.forecastBias.upsert({
      where: { tariffType: TariffPeriod.NIGHT },
      create: {
        tariffType: TariffPeriod.NIGHT,
        biasValue: patch.night,
      },
      update: { biasValue: patch.night },
    });
  }
  return getForecastBiasForAdmin();
}
