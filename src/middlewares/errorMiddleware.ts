import type { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/httpError.js";

const GENERIC_500_UK = "На сервері сталася помилка. Спробуйте пізніше.";

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError && err.status < 500) {
    console.warn(`[HTTP ${err.status}]`, err.message);
  } else {
    console.error(err);
  }
  const status = err instanceof HttpError ? err.status : 500;
  const rawMessage = err instanceof Error ? err.message : String(err);
  /** Не віддаємо клієнту сирі Prisma/стек-тексти для невідомих 5xx. */
  const message =
    status === 500 && !(err instanceof HttpError) ? GENERIC_500_UK : rawMessage;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : "Request error",
    message,
  });
};
