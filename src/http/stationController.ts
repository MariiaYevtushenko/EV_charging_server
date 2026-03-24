import type { Request, RequestHandler } from "express";
import { stationService } from "../services/stationService.js";

function stationIdParam(req: Request): string | undefined {
  const raw = req.params["stationId"];
  return typeof raw === "string" ? raw.trim() : undefined;
}

function parsePositiveIntId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (n < 1 || n > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return n;
}

export const getStationDashboard: RequestHandler = async (req, res, next) => {
  try {
    const stationId = parsePositiveIntId(stationIdParam(req));
    if (stationId === null) {
      res.status(400).json({ error: "Invalid station id (expected positive integer)" });
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
