import type { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/httpError.js";

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({
    error: status === 500 ? "Internal server error" : "Request error",
    message,
  });
};
