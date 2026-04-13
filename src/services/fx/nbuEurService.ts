/**
 * Офіційний курс НБУ: скільки гривень за 1 EUR (поле `rate`).
 * https://bank.gov.ua/ua/open-data/api-dev
 */
export type NbuEurRateDto = {
  /** UAH за 1 EUR */
  rateUahPerEur: number;
  /** Дата курсу з НБУ (ДД.ММ.РРРР) */
  exchangeDate: string;
};

export async function fetchNbuEurRateUah(): Promise<NbuEurRateDto> {
  const url =
    "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&json";
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) {
    throw new Error(`НБУ: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{ rate?: string | number; exchangedate?: string }>;
  const row = data[0];
  if (!row) {
    throw new Error("НБУ: порожня відповідь");
  }
  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("НБУ: некоректний курс EUR");
  }
  return {
    rateUahPerEur: rate,
    exchangeDate: row.exchangedate?.trim() ?? "",
  };
}
