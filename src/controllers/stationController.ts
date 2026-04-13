import type { RequestHandler } from "express";
import { stationService } from "../services/stationService.js";
import { parsePaginationQuery } from "../lib/pagination.js";
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

const MAP_BOUNDS_DEFAULT_LIMIT = 2500;
const MAP_BOUNDS_MAX_LIMIT = 5000;

/** Станції для карти у видимому прямокутнику: minLat, maxLat, minLng, maxLng; опційно limit (1…5000). */
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
    const { page, pageSize, skip } = parsePaginationQuery(
      req.query as Record<string, unknown>
    );
    const data = await stationService.getStationsPage(skip, pageSize, page, pageSize);
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


