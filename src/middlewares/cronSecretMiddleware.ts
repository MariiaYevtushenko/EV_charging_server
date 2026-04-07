import type { RequestHandler } from "express";

/**
 * Якщо задано CRON_SECRET — вимагає заголовок X-Cron-Secret.
 * Інакше (локальна розробка) пропускає.
 */
export const requireCronSecret: RequestHandler = (req, res, next) => {
  const secret = process.env["CRON_SECRET"];
  if (!secret) {
    next();
    return;
  }
  const header = req.headers["x-cron-secret"];
  if (header !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};
