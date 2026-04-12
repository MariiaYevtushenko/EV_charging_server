/** Скорочення рядка до `max` символів після trim (для полів CSV / БД). */
export function TruncateStr(s: unknown, max: number): string {
  if (s == null) return "";
  const t = String(s).trim();
  return t.length <= max ? t : t.slice(0, max);
}

/** Розбиття адреси на вулицю та номер будинку (евристика для ev_stations CSV). */
export function SplitStreetHouse(address: string): {
  street: string;
  houseNumber: string;
} {
  const t = String(address ?? "").trim() || "—";
  const m = t.match(/^(.+?)\s+(\d+[a-zA-Zа-яА-ЯіІїЇєЄ/\-]*)$/u);

  if (m?.[1] != null && m[2] != null) {
    return {
      street: TruncateStr(m[1].trim(), 100),
      houseNumber: TruncateStr(m[2], 10),
    };
  }

  return {
    street: TruncateStr(t, 100),
    houseNumber: "1",
  };
}
