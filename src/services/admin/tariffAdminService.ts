import { TariffPeriod } from "../../../generated/prisma/index.js";
import { tariffRepository } from "../../db/tariffRepository.js";
import { dateKeyLocal, localDateAtNoon } from "../../utils/tariffDateUtils.js";

export type TariffListItemDto = {
  id: number;
  tariffType: "DAY" | "NIGHT";
  pricePerKwh: number;
  /** YYYY-MM-DD (локальний календар, як у upsert). */
  effectiveDate: string;
};

export type TodayTariffsDto = {
  date: string;
  dayPrice: number;
  nightPrice: number;
};

function rowToDto(r: {
  id: number;
  tariffType: TariffPeriod;
  pricePerKwh: unknown;
  effectiveDate: Date;
}): TariffListItemDto {
  return {
    id: r.id,
    tariffType: r.tariffType,
    pricePerKwh: Number(r.pricePerKwh),
    effectiveDate: dateKeyLocal(localDateAtNoon(r.effectiveDate)),
  };
}

export async function listTariffs(): Promise<TariffListItemDto[]> {
  const rows = await tariffRepository.listAll();
  return rows.map(rowToDto);
}

export async function getTodayTariffs(): Promise<TodayTariffsDto> {
  const today = new Date();
  const noon = localDateAtNoon(today);
  const rows = await tariffRepository.findForCalendarDay(today);
  const day = rows.find((x) => x.tariffType === TariffPeriod.DAY);
  const night = rows.find((x) => x.tariffType === TariffPeriod.NIGHT);
  return {
    date: dateKeyLocal(noon),
    dayPrice: day ? Number(day.pricePerKwh) : 0,
    nightPrice: night ? Number(night.pricePerKwh) : 0,
  };
}

/**
 * Оновлює лише тарифи на поточну календарну дату (сьогодні). Минулі дати через API не змінюються.
 */
export async function putTodayTariffs(dayPrice: number, nightPrice: number): Promise<TodayTariffsDto> {
  if (!Number.isFinite(dayPrice) || !Number.isFinite(nightPrice)) {
    throw new Error("dayPrice and nightPrice must be finite numbers");
  }
  if (dayPrice < 0 || nightPrice < 0) {
    throw new Error("Prices must be non-negative");
  }
  await tariffRepository.upsertDayNightForCalendarDay(new Date(), dayPrice, nightPrice);
  return getTodayTariffs();
}
