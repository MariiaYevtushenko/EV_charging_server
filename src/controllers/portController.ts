import type { Request, RequestHandler } from "express";
import {portService } from "../services/portService.js";


export const createPort: RequestHandler = async (req, res, next) => {
    try {
     
      const port = await portService.createPort(req.body);
      res.json(port);
    } catch (e) {
      next(e);
    }
  };
  
  export const updatePort: RequestHandler = async (req, res, next) => {
    try {
      const portId = Number(req.params["portId"]);
      if (!portId) {
        res.status(400).json({ error: "Port id is required" });
        return;
      }
      const port = await portService.updatePort(portId, req.body);
      res.json(port);
    } catch (e) {
      next(e);
    }
  };
  
  export const deletePort: RequestHandler = async (req, res, next) => {
    try {
      const portId = Number(req.params["portId"]);
      if (!portId) {
        res.status(400).json({ error: "Port id is required" });
        return;
      }
      const port = await portService.deletePort(portId);
      res.json(port);
    } catch (e) {
      next(e);
    }
  };