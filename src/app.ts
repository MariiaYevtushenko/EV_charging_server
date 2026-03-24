import express from "express";
import cors from "cors";
import { stationRouter } from "./http/stationRoutes.js";
import { errorMiddleware } from "./http/errorMiddleware.js";

const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function createApp() {
  const app = express();

  const clientOrigin = process.env["CLIENT_ORIGIN"];
  const origins = clientOrigin
    ? clientOrigin.split(",").map((s) => s.trim())
    : defaultOrigins;

  app.use(
    cors({
      origin: origins,
      credentials: true,
    })
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/stations", stationRouter);

  app.use(errorMiddleware);

  return app;
}
