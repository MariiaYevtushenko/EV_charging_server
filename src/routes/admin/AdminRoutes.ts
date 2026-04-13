import { Router } from "express";
import {
  getUsers,
  getUser,
  updateUser,
  getNetworkBooking,
  getNetworkBookings,
  getNetworkSession,
  getNetworkSessions,
} from "../../controllers/admin/adminController.js";
import {
  getForecastBias,
  postIngestTariff,
  postRunForecastModel,
  postUpdateBias,
  putForecastBias,
} from "../../controllers/admin/forecastController.js";
import { requireCronSecret } from "../../middlewares/cronSecretMiddleware.js";
import {
  getTariffsList,
  getTariffsToday,
  putTariffsToday,
} from "../../controllers/admin/tariffAdminController.js";

export const adminRouter = Router();

adminRouter.get("/users", getUsers);
adminRouter.get("/users/:userId", getUser);
adminRouter.put("/users/:userId", updateUser);

adminRouter.get("/network/bookings/:bookingId", getNetworkBooking);
adminRouter.get("/network/bookings", getNetworkBookings);
adminRouter.get("/network/sessions/:sessionId", getNetworkSession);
adminRouter.get("/network/sessions", getNetworkSessions);

adminRouter.get("/forecast/bias", getForecastBias);
adminRouter.put("/forecast/bias", putForecastBias);

adminRouter.get("/tariffs", getTariffsList);
adminRouter.get("/tariffs/today", getTariffsToday);
adminRouter.put("/tariffs/today", putTariffsToday);

adminRouter.post(
  "/forecast/ingest-tariff",
  requireCronSecret,
  postIngestTariff
);
adminRouter.post(
  "/forecast/run-model",
  requireCronSecret,
  postRunForecastModel
);
adminRouter.post(
  "/forecast/update-bias",
  requireCronSecret,
  postUpdateBias
);

