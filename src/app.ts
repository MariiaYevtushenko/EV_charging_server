import express from "express";
import cors from "cors";
import { stationRouter } from "./routes/stationRoutes.js";
import { EvUsersRouter } from "./routes/EvUsersRoutes.js";
import { evUserRouter } from "./routes/user/userRouter.js";
import { adminRouter } from "./routes/admin/AdminRoutes.js";
import { devSeedRouter } from "./routes/devSeedRoutes.js";
import { errorMiddleware } from "./middlewares/errorMiddleware.js";

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
  app.use("/api/users", EvUsersRouter);
  app.use("/api/user", evUserRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/dev", devSeedRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found", message: "Маршрут не знайдено." });
  });

  app.use(errorMiddleware);

  return app;
}
