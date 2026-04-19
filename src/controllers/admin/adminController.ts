import type { RequestHandler } from "express";
import type { UserRole } from "../../../generated/prisma/index.js";
import { adminService } from "../../services/admin/adminService.js";
import { toEvUserPublic } from "../../utils/evUserPublic.js";
import { parsePaginationQuery } from "../../lib/pagination.js";

function parseUserRoleFilter(raw: unknown): UserRole | undefined {
    if (typeof raw !== "string" || raw.trim() === "") return undefined;
    const s = raw.trim();
    if (s === "USER" || s === "STATION_ADMIN" || s === "ADMIN") {
        return s as UserRole;
    }
    return undefined;
}

export const getUsers: RequestHandler = async (req, res, next) => {
    try {
        const q = req.query as Record<string, unknown>;
        const { page, pageSize, skip } = parsePaginationQuery(q);
        const roleFilter = parseUserRoleFilter(q["role"]);
        const rawSearch = q["q"];
        const search =
            typeof rawSearch === "string" && rawSearch.trim() !== "" ? rawSearch.trim() : undefined;
        const data = await adminService.getUsersPage(skip, pageSize, page, pageSize, roleFilter, search);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!Number.isFinite(userId) || userId < 1) {
            res.status(400).json({
                error: "Bad Request",
                message: "Некоректний ідентифікатор користувача.",
            });
            return;
        }
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

/** Усі платежі (bill) у мережі — сторінка «Платежі». */
export const getNetworkPayments: RequestHandler = async (_req, res, next) => {
    try {
        const data = await adminService.getNetworkPayments();
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getDashboard: RequestHandler = async (_req, res, next) => {
    try {
        const data = await adminService.getDashboardSummary();
        res.json(data);
    } catch (e) {
        next(e);
    }
};

/** Дані з SQL VIEW (View.sql) для сторінки аналітики глобального адміна. */
export const getAnalyticsViews: RequestHandler = async (_req, res, next) => {
    try {
        const data = await adminService.getAnalyticsViews();
        res.json(data);
    } catch (e) {
        next(e);
    }
};