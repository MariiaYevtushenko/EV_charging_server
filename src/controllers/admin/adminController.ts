import type { RequestHandler } from "express";
import { adminService } from "../../services/admin/adminService.js";
import { toEvUserPublic } from "../../utils/evUserPublic.js";
import { parsePaginationQuery } from "../../lib/pagination.js";

export const getUsers: RequestHandler = async (req, res, next) => {
    try {
        const { page, pageSize, skip } = parsePaginationQuery(
            req.query as Record<string, unknown>
        );
        const data = await adminService.getUsersPage(skip, pageSize, page, pageSize);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await adminService.getUser(userId);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};

export const updateUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await adminService.updateUser(userId, req.body);
        res.json(toEvUserPublic(user));
    }
    catch (e) {
        next(e);
    }
};

export const getNetworkBooking: RequestHandler = async (req, res, next) => {
    try {
        const bookingId = Number(req.params["bookingId"]);
        if (!Number.isFinite(bookingId)) {
            res.status(400).json({
                error: "Bad Request",
                message: "Некоректний ідентифікатор бронювання.",
            });
            return;
        }
        const data = await adminService.getNetworkBookingById(bookingId);
        if (!data) {
            res.status(404).json({ error: "Not Found", message: "Бронювання не знайдено." });
            return;
        }
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getNetworkBookings: RequestHandler = async (_req, res, next) => {
    try {
        const data = await adminService.getNetworkBookings();
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getNetworkSession: RequestHandler = async (req, res, next) => {
    try {
        const sessionId = Number(req.params["sessionId"]);
        if (!Number.isFinite(sessionId)) {
            res.status(400).json({
                error: "Bad Request",
                message: "Некоректний ідентифікатор сесії.",
            });
            return;
        }
        const data = await adminService.getNetworkSessionById(sessionId);
        if (!data) {
            res.status(404).json({ error: "Not Found", message: "Сесію не знайдено." });
            return;
        }
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getNetworkSessions: RequestHandler = async (_req, res, next) => {
    try {
        const data = await adminService.getNetworkSessions();
        res.json(data);
    } catch (e) {
        next(e);
    }
};