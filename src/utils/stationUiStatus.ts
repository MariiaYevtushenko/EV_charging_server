import type { StationStatus } from "../../generated/prisma/index.js";

/** Статус станції з клієнта (рядок) → Prisma enum */
export function parseStationStatus(raw: unknown): StationStatus {
  const s = String(raw ?? "").trim();
  switch (s) {
    case "WORK":
    case "working":
      return "WORK";
    case "NO_CONNECTION":
    case "offline":
      return "NO_CONNECTION";
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
