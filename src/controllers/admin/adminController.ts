import type { RequestHandler } from "express";
import type { UserRole } from "../../../generated/prisma/index.js";
import { adminService } from "../../services/admin/adminService.js";
import { toEvUserPublic } from "../../utils/evUserPublic.js";
import {
  parseAdminUsersSortQuery,
  parseNetworkBookingsQuery,
  parseNetworkListStatusCountsQuery,
  parseNetworkPaymentsQuery,
  parseNetworkSessionsQuery,
  parsePaginationQuery,
} from "../../lib/pagination.js";

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
        const { sort, order } = parseAdminUsersSortQuery(q);
        const data = await adminService.getUsersPage(
            skip,
            pageSize,
            page,
            pageSize,
            roleFilter,
            search,
            sort,
            order
        );
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

export const getNetworkBookings: RequestHandler = async (req, res, next) => {
    try {
        const parsed = parseNetworkBookingsQuery(req.query as Record<string, unknown>);
        const data = await adminService.getNetworkBookingsList(parsed);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getNetworkBookingStatusCounts: RequestHandler = async (req, res, next) => {
    try {
        const { search, period } = parseNetworkListStatusCountsQuery(req.query as Record<string, unknown>);
        const data = await adminService.getNetworkBookingStatusCounts(search, period);
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

/** Завершити активну сесію (COMPLETED + bill через UpsertBillForSession). */
export const postCompleteNetworkSession: RequestHandler = async (req, res, next) => {
    try {
        const sessionId = Number(req.params["sessionId"]);
        if (!Number.isFinite(sessionId)) {
            res.status(400).json({
                error: "Bad Request",
                message: "Некоректний ідентифікатор сесії.",
            });
            return;
        }
        const body = req.body as Record<string, unknown> | null | undefined;
        const raw = body?.["kwhConsumed"];
        const kwhConsumed =
            raw === undefined || raw === null
                ? undefined
                : Number(raw);
        if (
            kwhConsumed !== undefined &&
            (!Number.isFinite(kwhConsumed) || kwhConsumed < 0)
        ) {
            res.status(400).json({
                error: "Bad Request",
                message: "Некоректне значення kwhConsumed (очікується число ≥ 0).",
            });
            return;
        }
        const data = await adminService.completeNetworkSession(sessionId, kwhConsumed);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getNetworkSessions: RequestHandler = async (req, res, next) => {
    try {
        const parsed = parseNetworkSessionsQuery(req.query as Record<string, unknown>);
        const data = await adminService.getNetworkSessionsList(parsed);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const getNetworkSessionStatusCounts: RequestHandler = async (req, res, next) => {
    try {
        const { search, period } = parseNetworkListStatusCountsQuery(req.query as Record<string, unknown>);
        const data = await adminService.getNetworkSessionStatusCounts(search, period);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

/** Лічильники за статусом платежу (bill) — узгоджено зі списком. */
export const getNetworkPaymentStatusCounts: RequestHandler = async (req, res, next) => {
    try {
        const { search, period } = parseNetworkListStatusCountsQuery(req.query as Record<string, unknown>);
        const data = await adminService.getNetworkPaymentStatusCounts(search, period);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

/** Платежі (bill) у мережі — пагінований список для сторінки «Платежі». */
export const getNetworkPayments: RequestHandler = async (req, res, next) => {
    try {
        const parsed = parseNetworkPaymentsQuery(req.query as Record<string, unknown>);
        const data = await adminService.getNetworkPaymentsList(parsed);
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