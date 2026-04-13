import { userRepository } from "../../db/user/userRepository.js";
import type { EvUser, Session, Vehicle, Booking, Bill, UserRole } from "../../../generated/prisma/index.js";
import type { Prisma } from "../../../generated/prisma/index.js";
import { HttpError } from "../../lib/httpError.js";
import {
  AssertValidEmail,
  AssertValidName,
  AssertValidPhoneNumber,
  AssertValidSurname,
  NormalizePhoneInput,
} from "../../lib/profileValidation.js";
import { verifyPassword } from "../../lib/password.js";

function buildProfileUpdate(body: unknown): Prisma.EvUserUpdateInput {
  const b = body as Record<string, unknown>;
  const data: Prisma.EvUserUpdateInput = {};
  if (typeof b.name === "string") {
    AssertValidName(b.name, "Ім'я");
    data.name = b.name.trim().slice(0, 50);
  }
  if (typeof b.surname === "string") {
    AssertValidSurname(b.surname);
    data.surname = b.surname.trim().slice(0, 50);
  }
  if (typeof b.email === "string") {
    AssertValidEmail(b.email);
    data.email = b.email.trim().toLowerCase().slice(0, 254);
  }
  const phoneRaw = b.phoneNumber ?? b.phone;
  if (typeof phoneRaw === "string") {
    const normalized = NormalizePhoneInput(phoneRaw);
    const stored = normalized === "" ? "-" : normalized;
    AssertValidPhoneNumber(stored);
    data.phoneNumber = stored === "-" ? "-" : stored.slice(0, 15);
  }
  if (typeof b.role === "string") {
    const r = b.role as UserRole;
    if (r === "USER" || r === "ADMIN" || r === "STATION_ADMIN") {
      data.role = r;
    }
  }
  return data;
}

export const userService = {
  async getUser(userId: number): Promise<EvUser> {
    return await userRepository.getUser(userId);
  },

  /** Оновлення полів профілю з тіла запиту (без passwordHash / id). */
  async updateProfileFromBody(userId: number, body: unknown): Promise<EvUser> {
    const data = buildProfileUpdate(body);
    if (data.email !== undefined) {
      const email = String(data.email);
      const taken = await userRepository.findByEmailExceptUser(email, userId);
      if (taken) {
        throw new HttpError(409, "Email вже зайнятий");
      }
    }
    if (Object.keys(data).length === 0) {
      return await userRepository.getUser(userId);
    }
    return await userRepository.updateUser(userId, data);
  },

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      throw new HttpError(400, "Новий пароль має містити щонайменше 6 символів");
    }
    const user = await userRepository.getUser(userId);
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      throw new HttpError(400, "Невірний поточний пароль");
    }
    await userRepository.updateUser(userId, { passwordHash: newPassword });
  },

  async getVehicles(userId: number): Promise<Vehicle[]> {
    return await userRepository.getVehicles(userId);
  },
  async getVehicle(userId: number, vehicleId: number): Promise<Vehicle> {
    return await userRepository.getVehicle(userId, vehicleId);
  },
  async updateVehicle(
    userId: number,
    vehicleId: number,
    data: Prisma.VehicleUpdateInput
  ): Promise<Vehicle> {
    return await userRepository.updateVehicle(userId, vehicleId, data);
  },
  async addVehicle(userId: number, data: Prisma.VehicleCreateInput): Promise<Vehicle> {
    return await userRepository.addVehicle(userId, data);
  },

  async getBookings(userId: number): Promise<Booking[]> {
    return await userRepository.getBookings(userId);
  },
  async getBooking(userId: number, bookingId: number): Promise<Booking> {
    return await userRepository.getBooking(userId, bookingId);
  },
  async createBooking(data: Prisma.BookingCreateInput): Promise<Booking> {
    return await userRepository.createBooking(data);
  },
  async updateBooking(userId: number, bookingId: number, data: Prisma.BookingUpdateInput): Promise<Booking> {
    return await userRepository.updateBooking(userId, bookingId, data);
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
  async createSession(data: Prisma.SessionCreateInput): Promise<Session> {
    return await userRepository.createSession(data);
  },
  async updateSession(userId: number, sessionId: number, data: Prisma.SessionUpdateInput): Promise<Session> {
    return await userRepository.updateSession(userId, sessionId, data);
  },
  async deleteSession(userId: number, sessionId: number): Promise<Session> {
    return await userRepository.deleteSession(userId, sessionId);
  },

  /** Рахунки (таблиця bill у DB_script.MD); маршрути залишено як /payments для сумісності */
  async getPayments(userId: number): Promise<Bill[]> {
    return await userRepository.getBills(userId);
  },
  async getPayment(userId: number, billId: number): Promise<Bill> {
    return await userRepository.getBill(userId, billId);
  },
  async updatePayment(userId: number, billId: number, data: Prisma.BillUpdateInput): Promise<Bill> {
    return await userRepository.updateBill(userId, billId, data);
  },
};
