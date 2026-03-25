import type { Request, RequestHandler } from "express";
import { userService } from "../../services/user/userService.js";


export const getUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await userService.getUser(userId);
        res.json(user);
    }
    catch (e) {
        next(e);
    }
};

export const updateUser: RequestHandler = async (req, res, next) => {
    try {
        const userId = Number(req.params["userId"]);
        const user = await userService.updateUser(userId, req.body);
        res.json(user);
    }
    catch (e) {
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
        const vehicle = await userService.addVehicle(userId, req.body);
        res.json(vehicle);
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
        const booking = await userService.createBooking(userId, req.body);
        res.json(booking);
    }
    catch (e) {
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
        const session = await userService.createSession(userId, req.body);
        res.json(session);
    }
    catch (e) {
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
        const paymentId = Number(req.params["paymentId"]);
        const payment = await userService.getPayment(paymentId);
        res.json(payment);
    }
    catch (e) {
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
