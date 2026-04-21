import prisma from "../../prisma.config.js";
import type {
  PrismaClient,
  EvUser,
  Vehicle,
  Booking,
  Session,
  Bill,
  PaymentMethod,
  Prisma,
} from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

export const userRepository = {
  async getUser(userId: number): Promise<EvUser> {
    return await db.evUser.findUniqueOrThrow({
      where: { id: userId },
    });
  },
  async updateUser(userId: number, data: Prisma.EvUserUpdateInput): Promise<EvUser> {
    return await db.evUser.update({
      where: { id: userId },
      data,
    });
  },

  async findByEmailExceptUser(email: string, exceptUserId: number): Promise<EvUser | null> {
    return await db.evUser.findFirst({
      where: {
        email: email.trim().toLowerCase(),
        NOT: { id: exceptUserId },
      },
    });
  },

  async getVehicles(userId: number): Promise<Vehicle[]> {
    return await db.vehicle.findMany({
      where: { userId: userId },
    });
  },
  async getVehicle(userId: number, vehicleId: number): Promise<Vehicle> {
    return await db.vehicle.findFirstOrThrow({
      where: { id: vehicleId, userId },
    });
  },
  async updateVehicle(
    userId: number,
    vehicleId: number,
    data: Prisma.VehicleUpdateInput
  ): Promise<Vehicle> {
    await db.vehicle.findFirstOrThrow({ where: { id: vehicleId, userId } });
    return await db.vehicle.update({
      where: { id: vehicleId },
      data,
    });
  },
  async addVehicle(_userId: number, data: Prisma.VehicleCreateInput): Promise<Vehicle> {
    return await db.vehicle.create({
      data,
    });
  },

  async getBookings(userId: number) {
    return await db.booking.findMany({
      where: { userId: userId },
      orderBy: { startTime: "desc" },
      include: {
        port: {
          include: {
            station: { include: { location: true } },
            connectorType: true,
          },
        },
      },
    });
  },
  async getBooking(userId: number, bookingId: number) {
    return await db.booking.findFirstOrThrow({
      where: { id: bookingId, userId },
      include: {
        port: {
          include: {
            station: { include: { location: true } },
            connectorType: true,
          },
        },
      },
    });
  },
  async createBooking(data: Prisma.BookingCreateInput): Promise<Booking> {
    return await db.booking.create({
      data,
    });
  },
  async updateBooking(userId: number, bookingId: number, data: Prisma.BookingUpdateInput): Promise<Booking> {
    await db.booking.findFirstOrThrow({ where: { id: bookingId, userId } });
    return await db.booking.update({
      where: { id: bookingId },
      data,
    });
  },
  async deleteBooking(userId: number, bookingId: number): Promise<Booking> {
    await db.booking.findFirstOrThrow({ where: { id: bookingId, userId } });
    return await db.booking.delete({
      where: { id: bookingId },
    });
  },

  async getSessions(userId: number) {
    return await db.session.findMany({
      where: { userId: userId },
      orderBy: { startTime: "desc" },
      include: {
        port: {
          include: {
            station: {
              include: { location: true },
            },
          },
        },
        bill: true,
      },
    });
  },
  async getSession(userId: number, sessionId: number) {
    return await db.session.findFirstOrThrow({
      where: { id: sessionId, userId },
      include: {
        port: {
          include: {
            station: {
              include: { location: true },
            },
          },
        },
        bill: true,
      },
    });
  },
  async createSession(data: Prisma.SessionCreateInput): Promise<Session> {
    return await db.session.create({
      data,
    });
  },
  async updateSession(userId: number, sessionId: number, data: Prisma.SessionUpdateInput): Promise<Session> {
    await db.session.findFirstOrThrow({ where: { id: sessionId, userId } });
    return await db.session.update({
      where: { id: sessionId },
      data,
    });
  },
  async deleteSession(userId: number, sessionId: number): Promise<Session> {
    await db.session.findFirstOrThrow({ where: { id: sessionId, userId } });
    return await db.session.delete({
      where: { id: sessionId },
    });
  },

  async getBills(userId: number) {
    return await db.bill.findMany({
      where: { session: { userId } },
      orderBy: { createdAt: "desc" },
      include: {
        session: {
          include: {
            booking: true,
            vehicle: true,
            port: {
              include: {
                station: true,
              },
            },
          },
        },
      },
    });
  },
  async getBill(userId: number, billId: number) {
    return await db.bill.findFirstOrThrow({
      where: { id: billId, session: { userId } },
      include: {
        session: {
          include: {
            booking: true,
            vehicle: true,
            port: {
              include: {
                station: true,
              },
            },
          },
        },
      },
    });
  },
  async updateBill(userId: number, billId: number, data: Prisma.BillUpdateInput): Promise<Bill> {
    await db.bill.findFirstOrThrow({
      where: { id: billId, session: { userId } },
    });
    return await db.bill.update({
      where: { id: billId },
      data,
    });
  },

  /** Оплата очікуючого рахунку: спосіб оплати, SUCCESS, paid_at; оновлення бронювання за потреби. */
  async payPendingBill(userId: number, billId: number, paymentMethod: PaymentMethod): Promise<Bill> {
    return await db.$transaction(async (tx) => {
      const existing = await tx.bill.findFirst({
        where: {
          id: billId,
          paymentStatus: "PENDING",
          session: { userId },
        },
        include: {
          session: { select: { bookingId: true } },
        },
      });
      if (!existing) {
        throw new Error("BILL_NOT_PAYABLE");
      }

      const updated = await tx.bill.update({
        where: { id: billId },
        data: {
          paymentMethod,
          paymentStatus: "SUCCESS",
          paidAt: new Date(),
        },
      });

      if (existing.session.bookingId != null) {
        await tx.booking.update({
          where: { id: existing.session.bookingId },
          data: { status: "COMPLETED" },
        });
      }

      return updated;
    });
  },
};
