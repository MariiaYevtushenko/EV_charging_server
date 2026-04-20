import { Router } from "express";
import {
    getUsers,
    getUser,
    updateUser,
    getNetworkBooking,
    getNetworkBookingStatusCounts,
    getNetworkBookings,
    getNetworkSession,
    getNetworkSessionStatusCounts,
    getNetworkSessions,
    postCompleteNetworkSession,
    getNetworkPaymentStatusCounts,
    getNetworkPayments,
    getDashboard,
    getAnalyticsViews,
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
  postTariffsSyncMissing,
  postTariffsTodayRefresh,
  putTariffsToday,
} from "../../controllers/admin/tariffAdminController.js";
import { GetNbuEurUah } from "../../controllers/admin/fxController.js";

export const adminRouter = Router();

adminRouter.get("/dashboard", getDashboard);
adminRouter.get("/analytics/views", getAnalyticsViews);

adminRouter.get("/users", getUsers);
adminRouter.get("/users/:userId", getUser);
adminRouter.put("/users/:userId", updateUser);

adminRouter.get("/network/bookings/status-counts", getNetworkBookingStatusCounts);
adminRouter.get("/network/bookings/:bookingId", getNetworkBooking);
adminRouter.get("/network/bookings", getNetworkBookings);
adminRouter.get("/network/sessions/status-counts", getNetworkSessionStatusCounts);
adminRouter.post("/network/sessions/:sessionId/complete", postCompleteNetworkSession);
adminRouter.get("/network/sessions/:sessionId", getNetworkSession);
adminRouter.get("/network/sessions", getNetworkSessions);
adminRouter.get("/network/payments/status-counts", getNetworkPaymentStatusCounts);
adminRouter.get("/network/payments", getNetworkPayments);

adminRouter.get("/forecast/bias", getForecastBias);
adminRouter.put("/forecast/bias", putForecastBias);

adminRouter.get("/tariffs", getTariffsList);
adminRouter.get("/tariffs/today", getTariffsToday);
adminRouter.post("/tariffs/today/refresh", postTariffsTodayRefresh);
adminRouter.post("/tariffs/sync-missing", postTariffsSyncMissing);
adminRouter.put("/tariffs/today", putTariffsToday);

adminRouter.get("/fx/eur-uah", GetNbuEurUah);

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

