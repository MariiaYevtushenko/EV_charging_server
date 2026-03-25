import prisma from "../../prisma.config.js";
import type { PrismaClient, EvUser, Vehicle, Booking, Session, Payment } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export const userRepository = {
    async getUser(userId: number): Promise<EvUser> {
        return await db.evUser.findUniqueOrThrow({
            where: { id: userId },
        });
    },
    async updateUser(userId: number, user: EvUser): Promise<EvUser> {
        return await db.evUser.update({
            where: { id: userId },
            data: user,
        });
    },



    async getVehicles(userId: number): Promise<Vehicle[]> {
        return await db.vehicle.findMany({
            where: { userId: userId },
        });
    },
    async getVehicle(userId: number, vehicleId: number): Promise<Vehicle> {
        return await db.vehicle.findUniqueOrThrow({
            where: { id: vehicleId },
        });
    },
    async updateVehicle(userId: number, vehicleId: number, vehicle: Vehicle): Promise<Vehicle> {
        return await db.vehicle.update({
            where: { id: vehicleId },
            data: vehicle,
        });
    },
    async addVehicle(userId: number, vehicle: Vehicle): Promise<Vehicle> {
        return await db.vehicle.create({
            data: vehicle,
        });
    },



    async getBookings(userId: number): Promise<Booking[]> {
        return await db.booking.findMany({
            where: { userId: userId },
        });
    },
    async getBooking(userId: number, bookingId: number): Promise<Booking> {
        return await db.booking.findUniqueOrThrow({
            where: { id: bookingId },   
        });
    },
    async createBooking(userId: number, booking: Booking): Promise<Booking> {
        return await db.booking.create({
            data: booking,
        });
    },
    async updateBooking(userId: number, bookingId: number, booking: Booking): Promise<Booking> {
        return await db.booking.update({
            where: { id: bookingId },
            data: booking,
        });
    },
    async deleteBooking(userId: number, bookingId: number): Promise<Booking> {
        return await db.booking.delete({
            where: { id: bookingId },
        });
    },



    async getSessions(userId: number): Promise<Session[]> {
        return await db.session.findMany({
        where: { userId: userId },
        });
    },
    async getSession(userId: number, sessionId: number): Promise<Session> {
        return await db.session.findUniqueOrThrow({
            where: { id: sessionId },
        });
    },
    async createSession(userId: number, session: Session): Promise<Session> {
        return await db.session.create({
            data: session,
        });
    },
    async updateSession(userId: number, sessionId: number, session: Session): Promise<Session> {
        return await db.session.update({
            where: { id: sessionId },
            data: session,
        });
    },
    async deleteSession(userId: number, sessionId: number): Promise<Session> {
        return await db.session.delete({
            where: { id: sessionId },
        });
    },




    async getPayments(userId: number): Promise<Payment[]> {
        return await db.payment.findMany({
            where: { session: { userId: userId } },
        });
    },
    async getPayment(paymentId: number): Promise<Payment> {
        return await db.payment.findUniqueOrThrow({
            where: { id: paymentId },
        });
    },
    async updatePayment(userId: number, paymentId: number, payment: Payment): Promise<Payment> {
        return await db.payment.update({
            where: { id: paymentId },
            data: payment,
        });
    },
}   