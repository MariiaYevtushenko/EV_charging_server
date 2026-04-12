import type { RequestHandler } from "express";
import { userService } from "../../services/user/userService.js";
import type { Prisma } from "../../../generated/prisma/index.js";
import { BookingType, SessionStatus } from "../../../generated/prisma/index.js";
import { computePrepaymentForCalcBooking } from "../../services/forecast/bookingPricingService.js";
import { toEvUserPublic } from "../../utils/evUserPublic.js";


export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await userService.getUser(userId);
        res.json(toEvUserPublic(user));
    }
    catch (e) {
        next(e);
    }
};

export const updateUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await userService.updateProfileFromBody(userId, req.body);
        res.json(toEvUserPublic(user));
    }
    catch (e) {
        next(e);
    }
};

export const changePassword: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!Number.isFinite(userId) || userId <= 0) {
            res.status(400).json({ error: "Некоректний ідентифікатор користувача" });
            return;
        }
        const b = req.body as Record<string, unknown>;
        const currentPassword = String(b["currentPassword"] ?? "");
        const newPassword = String(b["newPassword"] ?? "");
        await userService.changePassword(userId, currentPassword, newPassword);
        res.json({ ok: true });
    } catch (e) {
        next(e);
    }
};

export const getVehicles: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const vehicles = await userService.getVehicles(userId);
        res.json(vehicles);
    }
    catch (e) {
        next(e);
    }
};

export const getVehicle: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const vehicleId = Number(req.params["vehicleId"]);
        const vehicle = await userService.getVehicle(userId, vehicleId);
        res.json(vehicle);
    }
    catch (e) {
        next(e);
    }
};

export const updateVehicle: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const vehicleId = Number(req.params["vehicleId"]);
        const vehicle = await userService.updateVehicle(userId, vehicleId, req.body);
        res.json(vehicle);
    }
    catch (e) {
        next(e);
    }
};

export const addVehicle: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!Number.isFinite(userId) || userId <= 0) {
            res.status(400).json({ error: "Invalid user id" });
            return;
        }
        const b = req.body as Record<string, unknown>;
        const licensePlate = String(b["licensePlate"] ?? "").trim();
        const brand = String(b["brand"] ?? "").trim();
        const vehicleModel = String(b["vehicleModel"] ?? b["model"] ?? "").trim();
        const batteryCapacity = Number(b["batteryCapacity"]);
        if (!licensePlate || !brand || !vehicleModel) {
            res.status(400).json({ error: "Потрібні licensePlate, brand та vehicleModel (або model)" });
            return;
        }
        if (!Number.isFinite(batteryCapacity) || batteryCapacity <= 0) {
            res.status(400).json({ error: "batteryCapacity має бути додатним числом" });
            return;
        }
        const data: Prisma.VehicleCreateInput = {
            user: { connect: { id: userId } },
            licensePlate,
            brand,
            vehicleModel,
            batteryCapacity,
        };
        const vehicle = await userService.addVehicle(userId, data);
        res.status(201).json(vehicle);
    }
    catch (e) {
        next(e);
    }
};

export const getBookings: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const bookings = await userService.getBookings(userId);
        res.json(bookings);
    }
    catch (e) {
        next(e);
    }
};

export const getBooking: RequestHandler = async (req, res, next) => {           
    try {
        const userId = Number(req.params["userId"]);
        const bookingId = Number(req.params["bookingId"]);
        const booking = await userService.getBooking(userId, bookingId);
        res.json(booking);
    }
    catch (e) {
        next(e);
    }
};

export const createBooking: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const b = req.body as Record<string, unknown>;
        const stationId = Number(b["stationId"]);
        const portNumber = Number(b["portNumber"]);
        if (!Number.isFinite(stationId) || !Number.isFinite(portNumber)) {
            res.status(400).json({ error: "stationId та portNumber обовʼязкові" });
            return;
        }
        const startTime = new Date(String(b["startTime"]));
        const bookingType =
            (b["bookingType"] as BookingType) ?? BookingType.CALC;

        let prepaymentAmount = 0;
        if (bookingType === BookingType.CALC && b["vehicleId"] != null) {
            prepaymentAmount = await computePrepaymentForCalcBooking(
                userId,
                Number(b["vehicleId"]),
                startTime
            );
        } else if (bookingType === BookingType.DEPOSIT) {
            prepaymentAmount = Number(process.env["DEPOSIT_AMOUNT_UAH"] ?? 100);
        } else {
            prepaymentAmount =
                b["prepaymentAmount"] != null ? Number(b["prepaymentAmount"]) : 0;
        }

        const bookingInput: Prisma.BookingCreateInput = {
            user: { connect: { id: userId } },
            port: {
                connect: {
                    stationId_portNumber: { stationId, portNumber },
                },
            },
            startTime,
            endTime: new Date(String(b["endTime"])),
            prepaymentAmount,
            bookingType,
        };
        if (b["vehicleId"] != null) {
            bookingInput.vehicle = { connect: { id: Number(b["vehicleId"]) } };
        }
        const booking = await userService.createBooking(bookingInput);
        res.json(booking);
    } catch (e) {
        next(e);
    }
};

export const updateBooking: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const bookingId = Number(req.params["bookingId"]);
        const booking = await userService.updateBooking(userId, bookingId, req.body);
        res.json(booking);
    }
    catch (e) {
        next(e);
    }
};

export const deleteBooking: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const bookingId = Number(req.params["bookingId"]);
        const booking = await userService.deleteBooking(userId, bookingId);
        res.json(booking);
    }
    catch (e) {
        next(e);
    }
};

export const getSessions: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const sessions = await userService.getSessions(userId);
        res.json(sessions);
    }
    catch (e) {
        next(e);
    }
};

export const getSession: RequestHandler = async (req, res, next) => {   
    try {
        const userId = Number(req.params["userId"]);
        const sessionId = Number(req.params["sessionId"]);
        const session = await userService.getSession(userId, sessionId);
        res.json(session);
    }
    catch (e) {
        next(e);
    }
};

export const createSession: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const s = req.body as Record<string, unknown>;
        const stationId = Number(s["stationId"]);
        const portNumber = Number(s["portNumber"]);
        if (!Number.isFinite(stationId) || !Number.isFinite(portNumber)) {
            res.status(400).json({ error: "stationId та portNumber обовʼязкові" });
            return;
        }
        const sessionInput: Prisma.SessionCreateInput = {
            user: { connect: { id: userId } },
            port: {
                connect: {
                    stationId_portNumber: { stationId, portNumber },
                },
            },
            startTime:
                s["startTime"] != null
                    ? new Date(String(s["startTime"]))
                    : new Date(),
            kwhConsumed:
                s["kwhConsumed"] != null ? Number(s["kwhConsumed"]) : 0,
            status: (s["status"] as SessionStatus) ?? SessionStatus.ACTIVE,
        };
        if (s["vehicleId"] != null) {
            sessionInput.vehicle = { connect: { id: Number(s["vehicleId"]) } };
        }
        if (s["bookingId"] != null) {
            sessionInput.booking = { connect: { id: Number(s["bookingId"]) } };
        }
        if (s["endTime"] != null) {
            sessionInput.endTime = new Date(String(s["endTime"]));
        }
        const session = await userService.createSession(sessionInput);
        res.json(session);
    } catch (e) {
        next(e);
    }
};

export const updateSession: RequestHandler = async (req, res, next) => {
    try {   
        const userId = Number(req.params["userId"]);
        const sessionId = Number(req.params["sessionId"]);
        const session = await userService.updateSession(userId, sessionId, req.body);
        res.json(session);
    }
    catch (e) {
        next(e);
    }
};

export const getPayments: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const payments = await userService.getPayments(userId);
        res.json(payments);
    }
    catch (e) {
        next(e);
    }
};

export const getPayment: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const paymentId = Number(req.params["paymentId"]);
        const payment = await userService.getPayment(userId, paymentId);
        res.json(payment);
    } catch (e) {
        next(e);
    }
};

export const updatePayment: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const paymentId = Number(req.params["paymentId"]);
        const payment = await userService.updatePayment(userId, paymentId, req.body);
        res.json(payment);
    }
    catch (e) {
        next(e);
    }
};
