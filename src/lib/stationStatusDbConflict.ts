import { Prisma } from "../../generated/prisma/index.js";
import { HttpError } from "./httpError.js";

/**
 * Текст для клієнта (RAISE у `CheckStationStatusBeforeChange` містить той самий український фрагмент
 * і префікс `STATION_ACTIVE_SESSION:` — його зручно ловити в обгортці Prisma / драйвера).
 */
const STATION_ACTIVE_SESSION_BLOCK =
  "Наразі триває зарядка на одному з портів станції; неможливо змінити статус станції";

function prismaErrorHaystack(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    parts.push(error.message);
    try {
      parts.push(JSON.stringify(error.meta ?? {}));
    } catch {
      /* ignore */
    }
  } else if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    parts.push(error.message);
  } else if (error instanceof Error) {
    parts.push(error.message);
  } else {
    parts.push(String(error));
  }
  return parts.join("\n");
}

export function rethrowIfStationStatusBlockedByActiveSession(error: unknown): never {
  const m = prismaErrorHaystack(error);
  if (
    m.includes("STATION_ACTIVE_SESSION") ||
    m.includes("триває зарядка") ||
    m.includes("неможливо змінити статус станції")
  ) {
    throw new HttpError(409, STATION_ACTIVE_SESSION_BLOCK);
  }
  throw error;
}
