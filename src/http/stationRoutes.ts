import { Router } from "express";
import { getAllStations, getStationDashboard } from "./stationController.js";

/**
 * Маршрути станцій. Префікс монтується в app: /api/stations
 * Спочатку статичні шляхи (/), потім параметризовані.
 */
export const stationRouter = Router();

stationRouter.get("/", getAllStations);
stationRouter.get("/:stationId/dashboard", getStationDashboard);
