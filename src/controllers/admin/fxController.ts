import type { RequestHandler } from "express";
import { fetchNbuEurRateUah } from "../../services/fx/nbuEurService.js";

/** GET /api/admin/fx/eur-uah — курс EUR до гривні (НБУ), для відображення тарифів у €. */
export const GetNbuEurUah: RequestHandler = async (_req, res, next) => {
  try {
    const data = await fetchNbuEurRateUah();
    res.json(data);
  } catch (e) {
    next(e);
  }
};
