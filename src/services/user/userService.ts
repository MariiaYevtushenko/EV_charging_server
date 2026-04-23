import { userRepository } from "../../db/user/userRepository.js";
import { parseUserAnalyticsPeriod, queryUserAnalytics } from "../../db/user/userAnalyticsRepository.js";
import { HttpError } from "../../lib/httpError.js";
import type {
  EvUser,
  Vehicle,
  Booking,
  Bill,
  UserRole,
  PaymentMethod,
} from "../../../generated/prisma/index.js";
import { SessionStatus } from "../../../generated/prisma/index.js";
import type { Prisma } from "../../../generated/prisma/index.js";
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

  /** Агрегати з БД (session + bill) для картки авто. */
  async getVehicleAggregates(userId: number, vehicleId: number) {
    const data = await userRepository.getVehicleAggregates(userId, vehicleId);
    if (!data) {
      throw new HttpError(404, "Авто не знайдено або недоступне");
    }
    return { vehicleId, ...data };
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

  async getBookings(userId: number) {
    return await userRepository.getBookings(userId);
  },
  async getBooking(userId: number, bookingId: number) {
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

  async getSessions(userId: number) {
    return await userRepository.getSessions(userId);
  },
  async getSession(userId: number, sessionId: number) {
    return await userRepository.getSession(userId, sessionId);
  },
  async createSession(data: Prisma.SessionCreateInput) {
    return await userRepository.createSession(data);
  },
  async updateSession(userId: number, sessionId: number, data: Prisma.SessionUpdateInput) {
    return await userRepository.updateSession(userId, sessionId, data);
  },

  /** Завершити ACTIVE-сесію: COMPLETED + kWh + end_time; bill і порт USED→FREE — тригер SessionCompletedFinalizeBill. */
  async completeActiveSession(userId: number, sessionId: number, kwhConsumed: number) {
    const existing = await userRepository.getSession(userId, sessionId);
    if (existing.status !== SessionStatus.ACTIVE) {
      throw new HttpError(409, "Сесія не активна або вже завершена");
    }
    const kwh = Math.round(kwhConsumed * 1000) / 1000;
    await userRepository.updateSession(userId, sessionId, {
      status: SessionStatus.COMPLETED,
      endTime: new Date(),
      kwhConsumed: kwh,
    });
    return await userRepository.getSession(userId, sessionId);
  },
  async deleteSession(userId: number, sessionId: number) {
    return await userRepository.deleteSession(userId, sessionId);
  },

  /** Рахунки (таблиця bill у DB_script.MD); маршрути залишено як /payments для сумісності */
  async getPayments(userId: number) {
    return await userRepository.getBills(userId);
  },
  async getPayment(userId: number, billId: number) {
    return await userRepository.getBill(userId, billId);
  },
  async updatePayment(userId: number, billId: number, data: Prisma.BillUpdateInput): Promise<Bill> {
    return await userRepository.updateBill(userId, billId, data);
  },

  /** Користувач обрав спосіб оплати для PENDING-рахунку; підтвердження оплати (демо). */
  async payPendingBill(userId: number, billId: number, paymentMethod: PaymentMethod): Promise<Bill> {
    await userRepository.payPendingBill(userId, billId, paymentMethod);
    return await userRepository.getBill(userId, billId);
  },

  async getUserAnalytics(userId: number, periodQuery: string | undefined) {
    const period = parseUserAnalyticsPeriod(periodQuery);
    return await queryUserAnalytics(userId, period);
  },
};
