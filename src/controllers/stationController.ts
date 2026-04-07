import type { RequestHandler } from "express";
import { stationService } from "../services/stationService.js";
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

export const getAllStations: RequestHandler = async (_req, res, next) => {
  try {
    const stations = await stationService.getAllStations();
    res.json(stations);
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


