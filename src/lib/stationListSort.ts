/** Параметр `sort` для GET /api/stations (узгоджено з клієнтом `sortValue`). */

export type StationListSortKey =
  | "name"
  | "city"
  | "country"
  | "status"
  | "todayRevenue"
  | "todaySessions";

export type StationListSortDir = "asc" | "desc";

export type ParsedStationListSort = {
  key: StationListSortKey;
  dir: StationListSortDir;
};

const KEYS: StationListSortKey[] = ["name", "city", "country", "status", "todayRevenue", "todaySessions"];
const DIRS: StationListSortDir[] = ["asc", "desc"];

export function parseStationListSort(query: Record<string, unknown>): ParsedStationListSort {
  const raw = String(query["sort"] ?? "name:asc");
  const i = raw.lastIndexOf(":");
  if (i <= 0) {
    return { key: "name", dir: "asc" };
  }
  const key = raw.slice(0, i) as StationListSortKey;
  const dir = raw.slice(i + 1) as StationListSortDir;
  return {
    key: KEYS.includes(key) ? key : "name",
    dir: DIRS.includes(dir) ? dir : "asc",
  };
}
