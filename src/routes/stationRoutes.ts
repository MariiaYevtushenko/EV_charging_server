import { Router } from "express";
import {
  getAllStations,
  getAvailableBookingSlots,
  getStationBookingDayLoad,
  getStationDashboard as getStation,
  getStationEnergyAnalytics,
  getStationUpcomingBookings,
  getStationsMap,
} from "../controllers/stationController.js";
import { getPublicTodayTariffs } from "../controllers/tariffPublicController.js";
import {
  createStation,
  updateStation,
  archiveStation,
  unarchiveStation,
  updateStationStatus,
  deleteStation,
} from "../controllers/stationController.js";
import { createPort, updatePort, deletePort } from "../controllers/portController.js";
/**
 * Маршрути станцій. Префікс монтується в app: /api/stations
 * Спочатку статичні шляхи (/), потім параметризовані.
 */
export const stationRouter = Router();

stationRouter.get("/map", getStationsMap);
stationRouter.get("/tariffs/today", getPublicTodayTariffs);
stationRouter.get("/", getAllStations);
stationRouter.post("/", createStation);
stationRouter.get("/:stationId/dashboard", getStation);
stationRouter.get("/:stationId/upcoming-bookings", getStationUpcomingBookings);
stationRouter.get("/:stationId/booking-day-load", getStationBookingDayLoad);
stationRouter.get("/:stationId/available-booking-slots", getAvailableBookingSlots);
stationRouter.get("/:stationId/analytics-energy", getStationEnergyAnalytics);

stationRouter.put("/:stationId", updateStation);
stationRouter.post("/:stationId/archive", archiveStation);
stationRouter.post("/:stationId/unarchive", unarchiveStation);
stationRouter.patch("/:stationId/status", updateStationStatus);

stationRouter.post("/:stationId/ports", createPort);
stationRouter.put("/:stationId/ports/:portId", updatePort);
stationRouter.delete("/:stationId/ports/:portId", deletePort);
stationRouter.delete("/:stationId", deleteStation);