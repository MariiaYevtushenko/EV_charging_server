import { Router } from "express";
import { getAllStations, getStationDashboard as getStation } from "../controllers/stationController.js";
import { createStation, updateStation, archiveStation, unarchiveStation, updateStationStatus } from "../controllers/stationController.js";
import { createPort, updatePort, deletePort } from "../controllers/portController.js";
/**
 * Маршрути станцій. Префікс монтується в app: /api/stations
 * Спочатку статичні шляхи (/), потім параметризовані.
 */
export const stationRouter = Router();

stationRouter.get("/", getAllStations);
stationRouter.get("/:stationId/dashboard", getStation);


stationRouter.post("/station", createStation);
stationRouter.put("/:stationId/dashboard", updateStation);
stationRouter.put("/:stationId/dashboard", archiveStation);
stationRouter.put("/:stationId/dashboard", unarchiveStation);
stationRouter.put("/:stationId/dashboard", updateStationStatus);

stationRouter.post("/:stationId/ports", createPort);
stationRouter.put("/:stationId/ports/:portId", updatePort);
stationRouter.delete("/:stationId/ports/:portId", deletePort);