import { userRepository } from "../../db/user/userRepository.js";
import type { EvUser, Session } from "../../../generated/prisma/index.js";
import type { Vehicle } from "../../../generated/prisma/index.js";
import type { Booking } from "../../../generated/prisma/index.js";
import { addVehicle, updateBooking } from "../../controllers/user/userController.js";
import type { Payment } from "../../../generated/prisma/index.js";

export const userService = {
    async getUser(userId: number): Promise<EvUser> {
        return await userRepository.getUser(userId);    
    },
    async updateUser(userId: number, user: EvUser): Promise<EvUser> {
        return await userRepository.updateUser(userId, user);
    },
    

    async getVehicles(userId: number): Promise<Vehicle[]> {
        return await userRepository.getVehicles(userId);
    },
    async getVehicle(userId: number, vehicleId: number): Promise<Vehicle> {
        return await userRepository.getVehicle(userId, vehicleId);
    },
    async updateVehicle(userId: number, vehicleId: number, vehicle: Vehicle): Promise<Vehicle> {
        return await userRepository.updateVehicle(userId, vehicleId, vehicle);
    },
    async addVehicle(userId: number, vehicle: Vehicle): Promise<Vehicle> {
        return await userRepository.addVehicle(userId, vehicle);
    },


    async getBookings(userId: number): Promise<Booking[]> {
        return await userRepository.getBookings(userId);
    },
    async getBooking(userId: number, bookingId: number): Promise<Booking> {
        return await userRepository.getBooking(userId, bookingId);
    },
    async createBooking(userId: number, booking: Booking): Promise<Booking> {
        return await userRepository.createBooking(userId, booking);
    },
    async updateBooking(userId: number, bookingId: number, booking: Booking){
        return await userRepository.updateBooking(userId, bookingId, booking);
    },
    async deleteBooking(userId: number, bookingId: number): Promise<Booking> {
        return await userRepository.deleteBooking(userId, bookingId);
    },


    async getSessions(userId: number): Promise<Session[]> {
        return await userRepository.getSessions(userId);
    },
    async getSession(userId: number, sessionId: number): Promise<Session> {
        return await userRepository.getSession(userId, sessionId);
    },
   async createSession(userId: number, session: Session): Promise<Session> {
        return await userRepository.createSession(userId, session);
    },
    async updateSession(userId: number, sessionId: number, session: Session): Promise<Session> {
        return await userRepository.updateSession(userId, sessionId, session);
    },
    async deleteSession(userId: number, sessionId: number): Promise<Session> {
        return await userRepository.deleteSession(userId, sessionId);
    },


    async getPayments(userId: number): Promise<Payment[]> {
        return await userRepository.getPayments(userId);
    },
    async getPayment(paymentId: number): Promise<Payment> {
        return await userRepository.getPayment(paymentId);
    },
    async updatePayment(userId: number, paymentId: number, payment: Payment): Promise<Payment> {
        return await userRepository.updatePayment(userId, paymentId, payment);
    },
   
}   