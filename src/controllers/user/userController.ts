import type { RequestHandler } from "express";
import { userService } from "../../services/user/userService.js";
import type { Prisma, PaymentMethod } from "../../../generated/prisma/index.js";
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

/** GET — агреговані сесії / kWh / суми bill по авто (узгоджено з аналітикою в БД). */
export const getVehicleAggregates: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const vehicleId = Number(req.params["vehicleId"]);
        if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(vehicleId) || vehicleId <= 0) {
            res.status(400).json({ error: "Некоректні ідентифікатори" });
            return;
        }
        const data = await userService.getVehicleAggregates(userId, vehicleId);
        res.json(data);
    } catch (e) {
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
        const endTime = new Date(String(b["endTime"]));
        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
            res.status(400).json({ error: "Некоректні startTime або endTime" });
            return;
        }
        const durationMinutes = Math.max(
            1,
            Math.round((endTime.getTime() - startTime.getTime()) / 60000)
        );
        const bookingType =
            (b["bookingType"] as BookingType) ?? BookingType.CALC;

        let prepaymentAmount = 0;
        if (bookingType === BookingType.CALC) {
            if (b["vehicleId"] == null) {
                res.status(400).json({
                    error: "Для динамічної ціни оберіть автомобіль (vehicleId обовʼязковий)",
                });
                return;
            }
            prepaymentAmount = await computePrepaymentForCalcBooking(
                userId,
                Number(b["vehicleId"]),
                stationId,
                startTime,
                durationMinutes
            );
        } else if (bookingType === BookingType.DEPOSIT) {
            const rawDeposit = b["prepaymentAmount"];
            const fromBody =
                rawDeposit != null ? Number(rawDeposit) : Number.NaN;
            prepaymentAmount = Number.isFinite(fromBody) && fromBody >= 0
                ? Math.round(fromBody * 100) / 100
                : Number(process.env["DEPOSIT_AMOUNT_UAH"] ?? 200);
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
            endTime,
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

/** POST body: { paymentMethod: 'CARD' | 'APPLE_PAY' | 'GOOGLE_PAY' } — для рахунку зі статусом PENDING. */
/** GET ?period=7d|30d|all — дані з VIEW та підсумки за обраним вікном. */
export const getUserAnalytics: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        if (!Number.isFinite(userId) || userId <= 0) {
            res.status(400).json({ error: "Некоректний ідентифікатор користувача" });
            return;
        }
        const q = req.query["period"];
        const periodStr = typeof q === "string" ? q : undefined;
        const data = await userService.getUserAnalytics(userId, periodStr);
        res.json(data);
    } catch (e) {
        next(e);
    }
};

export const postPayBill: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const paymentId = Number(req.params["paymentId"]);
        const raw = (req.body as Record<string, unknown>)?.["paymentMethod"];
        const pm = typeof raw === "string" ? raw : "";
        const allowed: PaymentMethod[] = ["CARD", "APPLE_PAY", "GOOGLE_PAY"];
        if (!allowed.includes(pm as PaymentMethod)) {
            res.status(400).json({
                error: "Request error",
                message: "Оберіть спосіб оплати: CARD, APPLE_PAY або GOOGLE_PAY.",
            });
            return;
        }
        const bill = await userService.payPendingBill(userId, paymentId, pm as PaymentMethod);
        res.json(bill);
    } catch (e) {
        if (e instanceof Error && e.message === "BILL_NOT_PAYABLE") {
            res.status(409).json({
                error: "Request error",
                message: "Рахунок недоступний для оплати (не знайдено або вже оплачено).",
            });
            return;
        }
        next(e);
    }
};
