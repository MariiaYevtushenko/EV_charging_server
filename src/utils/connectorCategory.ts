/** Відомі псевдоніми UI / CSV → код у `connector_type.name`. */
const ALIASES: Record<string, string> = {
  "Type 2": "TYPE_2",
  TYPE_2: "TYPE_2",
  CCS2: "CCS_2",
  "CCS 2": "CCS_2",
  CCS_2: "CCS_2",
  CHAdeMO: "CHADEMO",
  CHADEMO: "CHADEMO",
  Tesla: "TESLA_SUPERCHARGER",
  TESLA_SUPERCHARGER: "TESLA_SUPERCHARGER",
  "Type 1": "TYPE_2",
};

/**
 * Повертає код для `connector_type.name`: відомі мітки → канонічний код;
 * рядок уже у вигляді `LIKE_THIS` залишається; інакше — безпечний дефолт.
 */
export function parseConnectorCategory(raw: string): string {
  const s = raw.trim();
  if (!s) return "TYPE_2";
  const mapped = ALIASES[s];
  if (mapped) return mapped;
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) return s.toUpperCase();
  return "TYPE_2";
}
