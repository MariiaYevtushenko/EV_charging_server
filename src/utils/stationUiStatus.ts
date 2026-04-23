import type { StationStatus } from "../../generated/prisma/index.js";

/** Статус станції з клієнта (рядок) → Prisma enum */
export function parseStationStatus(raw: unknown): StationStatus {
  const s = String(raw ?? "").trim();
  switch (s) {
    case "WORK":
    case "working":
      return "WORK";
    case "NOT_WORKING":
    case "NO_CONNECTION":
    case "offline":
      return "NOT_WORKING";
    case "FIX":
    case "maintenance":
      return "FIX";
    case "ARCHIVED":
    case "archived":
      return "ARCHIVED";
    default:
      return "WORK";
  }
}
