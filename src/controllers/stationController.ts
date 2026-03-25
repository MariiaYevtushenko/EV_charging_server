import type { Request, RequestHandler } from "express";
import { stationService } from "../services/stationService.js";

function stationIdParam(req: Request): string | undefined {
  const raw = req.params["stationId"];
  return typeof raw === "string" ? raw.trim() : undefined;
}


export const getStationDashboard: RequestHandler = async (req, res, next) => {
  try {
    const stationId =Number(req.params["stationId"]);
    if (!stationId) {
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
   
    const station = await stationService.createStation(req.body);

    res.json(station);
  } catch (e) {
    next(e);
  }
};

export const updateStation: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!stationId) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    const station = await stationService.updateStation(stationId, req.body);
    res.json(station);
  } catch (e) {
    next(e);
  }
};

export const archiveStation: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!stationId) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    const station = await stationService.archiveStation(stationId);
    res.json(station);
  } catch (e) {
    next(e);
  }
};


export const unarchiveStation: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!stationId) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }
    const station = await stationService.unarchiveStation(stationId);
    res.json(station);
  } catch (e) {
    next(e);
  }
};


export const updateStationStatus: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    const status = req.body["status"];

    if (!stationId || !status) {
      res.status(400).json({ error: "Station id is required" });
      return;
    }

    const station = await stationService.updateStationStatus(stationId, status);
    res.json(station);
  } catch (e) {
    next(e);
  }
};


