import type { RequestHandler } from "express";
import { fetchNbuEurRateUah } from "../../services/fx/nbuEurService.js";


export const GetNbuEurUah: RequestHandler = async (_req, res, next) => {
  try {
    const data = await fetchNbuEurRateUah();
    res.json(data);
  } catch (e) {
    next(e);
  }
};
