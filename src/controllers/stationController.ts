import type { RequestHandler } from "express";
import { stationService } from "../services/stationService.js";
import { parsePaginationQuery } from "../lib/pagination.js";
import { parseStationListSort } from "../lib/stationListSort.js";
import {
  parseCreateStationBody,
  parseUpdateStationBody,
  stationWriteService,
} from "../services/stationWriteService.js";
import { parseStationStatus } from "../utils/stationUiStatus.js";

export const getStationDashboard: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }

    const dashboard = await stationService.getStationDashboard(stationId);
    if (!dashboard) {
      res.status(404).json({ error: "Station not found" });
      return;
    }

    res.json(dashboard);
  } catch (e) {
    next(e);
  }
};

export const getStationUpcomingBookings: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    const items = await stationService.getStationUpcomingBookings(stationId);
    if (!items) {
      res.status(404).json({ error: "Station not found" });
      return;
    }
    res.json({ items });
  } catch (e) {
    next(e);
  }
};

/** GET .../booking-day-load?date=YYYY-MM-DD — завантаженість станції за днем + надбавка до тарифу */
export const getStationBookingDayLoad: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    const dateStr = typeof req.query["date"] === "string" ? req.query["date"] : "";
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "stationId некоректний" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ error: "date має бути YYYY-MM-DD" });
      return;
    }
    const data = await stationService.getStationBookingDayLoad(stationId, dateStr);
    if (!data) {
      res.status(404).json({ error: "Станцію не знайдено" });
      return;
    }
    res.json(data);
  } catch (e) {
    next(e);
  }
};

/** GET .../available-booking-slots?portNumber&date=YYYY-MM-DD&slotMinutes&durationMinutes */
export const getAvailableBookingSlots: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    const portNumber = Number(req.query["portNumber"]);
    const dateStr = typeof req.query["date"] === "string" ? req.query["date"] : "";
    const slotMinutes = Number(req.query["slotMinutes"] ?? 30);
    const durationMinutes = Number(req.query["durationMinutes"]);
    if (!Number.isFinite(stationId) || !Number.isFinite(portNumber)) {
      res.status(400).json({ error: "stationId та portNumber обовʼязкові" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ error: "date має бути YYYY-MM-DD" });
      return;
    }
    if (!Number.isFinite(slotMinutes) || slotMinutes < 15 || slotMinutes > 120) {
      res.status(400).json({ error: "slotMinutes має бути від 15 до 120" });
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < slotMinutes || durationMinutes > 24 * 60) {
      res.status(400).json({ error: "durationMinutes некоректний" });
      return;
    }
    const result = await stationService.getAvailableBookingSlots(
      stationId,
      portNumber,
      dateStr,
      slotMinutes,
      durationMinutes
    );
    if (result.kind === "NOT_FOUND") {
      res.status(404).json({ error: "Станція не знайдена" });
      return;
    }
    if (result.kind === "BAD_PORT") {
      res.status(400).json({ error: "Порт не належить цій станції" });
      return;
    }
    res.json({ slots: result.slots });
  } catch (e) {
    next(e);
  }
};

export const getStationEnergyAnalytics: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    const raw = req.query["period"];
    const p = typeof raw === "string" ? raw : "1d";
    const period = p === "7d" || p === "30d" ? p : "1d";
    const data = await stationService.getStationEnergyAnalytics(stationId, period);
    if (!data) {
      res.status(404).json({ error: "Station not found" });
      return;
    }
    res.json(data);
  } catch (e) {
    next(e);
  }
};

const MAP_BOUNDS_DEFAULT_LIMIT = 2500;
const MAP_BOUNDS_MAX_LIMIT = 5000;

export const getStationsMap: RequestHandler = async (req, res, next) => {
  try {
    const q = req.query as Record<string, unknown>;
    const minLat = Number(q["minLat"]);
    const maxLat = Number(q["maxLat"]);
    const minLng = Number(q["minLng"]);
    const maxLng = Number(q["maxLng"]);
    const limitRaw = q["limit"] != null ? Number(q["limit"]) : MAP_BOUNDS_DEFAULT_LIMIT;

    if (
      !Number.isFinite(minLat) ||
      !Number.isFinite(maxLat) ||
      !Number.isFinite(minLng) ||
      !Number.isFinite(maxLng)
    ) {
      res.status(400).json({
        error:
          "Потрібні query-параметри minLat, maxLat, minLng, maxLng (числа) — межі видимої області карти.",
      });
      return;
    }
    if (minLat > maxLat || minLng > maxLng) {
      res.status(400).json({ error: "Некоректний bbox: min має бути ≤ max." });
      return;
    }

    let limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : MAP_BOUNDS_DEFAULT_LIMIT;
    limit = Math.min(MAP_BOUNDS_MAX_LIMIT, Math.max(1, limit));

    const items = await stationService.getStationsForMapInBounds(
      minLat,
      maxLat,
      minLng,
      maxLng,
      limit
    );
    res.json({ items, limit });
  } catch (e) {
    next(e);
  }
};

export const getAllStations: RequestHandler = async (req, res, next) => {
  try {
    const q = req.query as Record<string, unknown>;
    const { page, pageSize, skip } = parsePaginationQuery(q);
    const sort = parseStationListSort(q);
    const rawStatus = q["status"];
    const statusFilter =
      typeof rawStatus === "string" && rawStatus.trim() !== ""
        ? parseStationStatus(rawStatus)
        : undefined;
    const rawSearch = q["q"];
    const search =
      typeof rawSearch === "string" && rawSearch.trim() !== "" ? rawSearch.trim() : undefined;
    const data = await stationService.getStationsPage(
      skip,
      pageSize,
      page,
      pageSize,
      sort,
      statusFilter,
      search
    );
    res.json(data);
  } catch (e) {
    next(e);
  }
};

export const createStation: RequestHandler = async (req, res, next) => {
  try {
    const input = parseCreateStationBody(req.body as Record<string, unknown>);
    const dashboard = await stationWriteService.createStation(input);
    if (!dashboard) {
      res.status(500).json({ error: "Не вдалося створити станцію" });
      return;
    }
    res.status(201).json(dashboard);
  } catch (e) {
    next(e);
  }
};

export const updateStation: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    const input = parseUpdateStationBody(req.body as Record<string, unknown>);
    const dashboard = await stationWriteService.updateStation(stationId, input);
    if (!dashboard) {
      res.status(404).json({ error: "Station not found" });
      return;
    }
    res.json(dashboard);
  } catch (e) {
    next(e);
  }
};

export const archiveStation: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    await stationService.archiveStation(stationId);
    const dashboard = await stationService.getStationDashboard(stationId);
    res.json(dashboard ?? { ok: true });
  } catch (e) {
    next(e);
  }
};


export const unarchiveStation: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    await stationService.unarchiveStation(stationId);
    const dashboard = await stationService.getStationDashboard(stationId);
    res.json(dashboard ?? { ok: true });
  } catch (e) {
    next(e);
  }
};


export const deleteStation: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    const deleted = await stationService.deleteStation(stationId);
    if (!deleted) {
      res.status(404).json({ error: "Station not found" });
      return;
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
};

export const updateStationStatus: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    const rawStatus = req.body["status"];

    if (!Number.isFinite(stationId) || rawStatus === undefined || rawStatus === null) {
      res.status(400).json({ error: "Station id and status are required" });
      return;
    }

    const status = parseStationStatus(rawStatus);
    await stationService.updateStationStatus(stationId, status);
    const dashboard = await stationService.getStationDashboard(stationId);
    if (!dashboard) {
      res.status(404).json({ error: "Station not found" });
      return;
    }
    res.json(dashboard);
  } catch (e) {
    next(e);
  }
};


