import { Router } from "express";
import { getUsers, getUser, updateUser } from "../../controllers/admin/adminController.js";
import {
  postIngestTariff,
  postRunForecastModel,
  postUpdateBias,
} from "../../controllers/admin/forecastController.js";
import { requireCronSecret } from "../../middlewares/cronSecretMiddleware.js";

export const adminRouter = Router();

adminRouter.get("/users", getUsers);
adminRouter.get("/users/:userId", getUser);
adminRouter.put("/users/:userId", updateUser);

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

