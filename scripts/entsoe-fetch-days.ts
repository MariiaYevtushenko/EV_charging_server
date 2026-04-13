/**
 * ENTSO-E A44: середні денні / нічні ціни (як у робочому axios-скрипті).
 * Кількість днів: ENTSOE_FETCH_DAYS або TARIFF_SEED_DAYS (дефолт 7).
 * Доби в UTC (periodStart/End як у твоєму formatDate + Date.UTC).
 *
 *   npx tsx scripts/entsoe-fetch-days.ts
 *
 * У server/.env: TOKEN=..., опційно TARIFF_API_URL, ENTSOE_IN_DOMAIN, ENTSOE_OUT_DOMAIN.
 */
import "./seed/loadServerEnv.js";
import axios from "axios";
import { parseStringPromise } from "xml2js";

function formatDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}`;
}

type TwoZone = {
  day_MWh: number;
  night_MWh: number;
  day_kWh: number;
  night_kWh: number;
  /** Усі інтервали з A44 (зазвичай 96×15 хв), €/MWh на кожен крок */
  intervalMwh: number[];
};

/** Точні 15-хв слоти (0…95) для повної доби 96×15 хв UTC */
function intervalLabelUtc96(i0: number): string {
  const startMin = i0 * 15;
  const endMin = startMin + 15;
  const fmt = (m: number): string => {
    if (m >= 1440) return "24:00";
    const h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  return `${fmt(startMin)}–${fmt(endMin)} UTC`;
}

/** Будь-яка кількість кроків N: рівномірний поділ 24h (якщо N≠96, час наближений) */
function intervalLabel(i0: number, total: number): string {
  if (total === 96) return intervalLabelUtc96(i0);
  const startMin = Math.round((i0 / total) * 1440);
  const endMin = Math.round(((i0 + 1) / total) * 1440);
  const fmt = (m: number): string => {
    if (m >= 1440) return "24:00";
    const h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  return `${fmt(startMin)}–${fmt(Math.min(endMin, 1440))} UTC`;
}

async function getTwoZonePrice(date: Date): Promise<TwoZone> {
  const start = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
    ),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const token = process.env["TOKEN"]?.trim();
  if (!token) {
    throw new Error("У .env має бути TOKEN (ENTSO-E securityToken).");
  }

  const apiUrl =
    process.env["TARIFF_API_URL"]?.trim() || "https://web-api.tp.entsoe.eu/api";
  const inDomain = process.env["ENTSOE_IN_DOMAIN"] ?? "10YPL-AREA-----S";
  const outDomain = process.env["ENTSOE_OUT_DOMAIN"] ?? inDomain;

  const response = await axios.get<string>(apiUrl, {
    params: {
      securityToken: token,
      documentType: "A44",
      in_Domain: inDomain,
      out_Domain: outDomain,
      periodStart: formatDate(start),
      periodEnd: formatDate(end),
    },
    timeout: 60_000,
    responseType: "text",
    transitional: { forcedJSONParsing: false },
  });

  const body: string =
    typeof response.data === "string" ? response.data : String(response.data ?? "");
  const parsed = (await parseStringPromise(body)) as {
    Publication_MarketDocument?: {
      TimeSeries: Array<{ Period: Array<{ Point: unknown }> }>;
    };
    Acknowledgement_MarketDocument?: unknown;
  };

  if (parsed.Acknowledgement_MarketDocument) {
    throw new Error("ENTSO-E повернув Acknowledgement (немає даних або помилка запиту).");
  }

  const pmd = parsed.Publication_MarketDocument;
  if (!pmd?.TimeSeries?.[0]?.Period?.[0]?.Point) {
    throw new Error("Немає Publication_MarketDocument / TimeSeries / Point у відповіді.");
  }

  const points = pmd.TimeSeries[0].Period[0].Point as Array<{
    "price.amount": string[];
  }>;

  const prices = points.map((p) => {
    const amt = p["price.amount"];
    const first = Array.isArray(amt) ? amt[0] : amt;
    return parseFloat(String(first ?? ""));
  });

  const dayPrices: number[] = [];
  const nightPrices: number[] = [];

  prices.forEach((price, index) => {
    const interval = index + 1;
    const hour = Math.floor((interval - 1) / 4);
    if (hour >= 7 && hour < 23) dayPrices.push(price);
    else nightPrices.push(price);
  });

  if (dayPrices.length === 0 || nightPrices.length === 0) {
    throw new Error("Порожній денний або нічний набір інтервалів.");
  }

  const avgDay = dayPrices.reduce((a, b) => a + b, 0) / dayPrices.length;
  const avgNight = nightPrices.reduce((a, b) => a + b, 0) / nightPrices.length;

  const raw = process.env["ENTSOE_CLAMP_NEGATIVE_PRICES"] === "false";
  const normMwh = (v: number) => (raw ? v : v < 0 ? Math.abs(v) : v);
  const dayMwh = normMwh(avgDay);
  const nightMwh = normMwh(avgNight);
  const intervalMwh = prices.map((v) =>
    Number.isFinite(v) ? normMwh(v) : NaN,
  );

  return {
    day_MWh: dayMwh,
    night_MWh: nightMwh,
    day_kWh: dayMwh / 1000,
    night_kWh: nightMwh / 1000,
    intervalMwh,
  };
}

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main(): Promise<void> {
  const rawN =
    process.env["ENTSOE_FETCH_DAYS"]?.trim() ||
    process.env["TARIFF_SEED_DAYS"]?.trim() ||
    "7";
  const n = Math.min(366, Math.max(1, Number.parseInt(rawN, 10) || 7));

  console.log(`ENTSO-E A44, останні ${n} повних UTC-доб (від учора назад).`);
  console.log(`Джерело N: ENTSOE_FETCH_DAYS / TARIFF_SEED_DAYS → ${n}`);
  if (process.env["ENTSOE_CLAMP_NEGATIVE_PRICES"] === "false") {
    console.log("ENTSOE_CLAMP_NEGATIVE_PRICES=false — сирі ціни з API (можуть бути <0).");
  } else {
    console.log(
      "Від’ємні €/MWh замінено на додатні (|x|). Сирі: ENTSOE_CLAMP_NEGATIVE_PRICES=false.",
    );
  }
  console.log("");

  const rows: { date: string; p: TwoZone | null; err?: string }[] = [];

  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1 - i);
    const label = utcDateKey(d);
    try {
      const p = await getTwoZonePrice(d);
      rows.push({ date: label, p });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({ date: label, p: null, err: msg });
    }
  }

  console.log("Середні ціни двозонного тарифу (€/MWh та €/kWh):\n");
  console.log(
    [
      "дата (UTC)".padEnd(12),
      "день MWh".padStart(12),
      "ніч MWh".padStart(12),
      "день kWh".padStart(12),
      "ніч kWh".padStart(12),
      "примітка",
    ].join("  "),
  );
  console.log("-".repeat(90));

  for (const row of rows) {
    if (row.p) {
      console.log(
        [
          row.date.padEnd(12),
          row.p.day_MWh.toFixed(2).padStart(12),
          row.p.night_MWh.toFixed(2).padStart(12),
          row.p.day_kWh.toFixed(4).padStart(12),
          row.p.night_kWh.toFixed(4).padStart(12),
          "",
        ].join("  "),
      );
    } else {
      console.log(
        `${row.date.padEnd(12)}  ${(row.err ?? "помилка").slice(0, 70)}`,
      );
    }
  }

  const yesterdayRow = rows[0];
  if (yesterdayRow?.p?.intervalMwh && yesterdayRow.p.intervalMwh.length > 0) {
    const iv = yesterdayRow.p.intervalMwh;
    console.log(
      `Усі інтервали за вчора (UTC ${yesterdayRow.date}), A44 — ${iv.length} крок(ів) у документі (очікувано 96 по 15 хв, якщо менше — так віддав ENTSO-E):`,
    );
    console.log("");
    console.log(
      ["#".padStart(4), "інтервал (UTC)".padEnd(22), "€/MWh".padStart(12), "€/kWh".padStart(12)].join(
        "  ",
      ),
    );
    console.log("-".repeat(58));
    for (let i = 0; i < iv.length; i++) {
      const mwh = iv[i] ?? NaN;
      const label = intervalLabel(i, iv.length);
      if (!Number.isFinite(mwh)) {
        console.log(
          [
            String(i + 1).padStart(4),
            label.padEnd(22),
            "—".padStart(12),
            "—".padStart(12),
          ].join("  "),
        );
        continue;
      }
      const kwh = mwh / 1000;
      console.log(
        [
          String(i + 1).padStart(4),
          label.padEnd(22),
          mwh.toFixed(2).padStart(12),
          kwh.toFixed(4).padStart(12),
        ].join("  "),
      );
    }
    console.log("");
  } else if (rows[0] && !rows[0].p) {
    console.log("(Інтервали за вчора не виведено — помилка запиту за першу добу.)\n");
  }

  console.log("");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
