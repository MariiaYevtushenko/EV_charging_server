import type { RequestHandler } from "express";
import { portService } from "../services/portService.js";

export const createPort: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    if (!Number.isFinite(stationId)) {
      res.status(400).json({ error: "stationId is required" });
      return;
    }
    const port = await portService.createPort(stationId, req.body);
    res.json(port);
  } catch (e) {
    next(e);
  }
};

export const updatePort: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    const portNumber = Number(req.params["portId"]);
    if (!Number.isFinite(stationId) || !Number.isFinite(portNumber)) {
      res.status(400).json({ error: "stationId and portId (номер порту) обовʼязкові" });
      return;
    }
    const port = await portService.updatePort(stationId, portNumber, req.body);
    res.json(port);
  } catch (e) {
    next(e);
  }
};

export const deletePort: RequestHandler = async (req, res, next) => {
  try {
    const stationId = Number(req.params["stationId"]);
    const portNumber = Number(req.params["portId"]);
    if (!Number.isFinite(stationId) || !Number.isFinite(portNumber)) {
      res.status(400).json({ error: "stationId and portId (номер порту) обовʼязкові" });
      return;
    }
    const port = await portService.deletePort(stationId, portNumber);
    res.json(port);
  } catch (e) {
    next(e);
  }
};
