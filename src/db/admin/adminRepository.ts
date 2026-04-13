import prisma from "../../prisma.config.js";
import type { PrismaClient, UserRole } from "../../../generated/prisma/index.js";
import { adminUserDetailInclude } from "../../services/admin/adminUserDetailMapper.js";

const db = prisma as unknown as PrismaClient;

/** Поля ev_user без password_hash (для списку в адмінці). */
export type EvUserPublicRow = {
  id: number;
  name: string;
  surname: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
  createdAt: Date;
};

export const adminRepository = {
  async countUsers(): Promise<number> {
    return db.evUser.count();
  },

  async getUsersPage(skip: number, take: number): Promise<EvUserPublicRow[]> {
    return await db.evUser.findMany({
      select: {
        id: true,
        name: true,
        surname: true,
        email: true,
        phoneNumber: true,
        role: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
      skip,
      take,
    });
  },

  async getUserDetailForAdmin(userId: number) {
    return await db.evUser.findUniqueOrThrow({
      where: { id: userId },
      include: adminUserDetailInclude,
    });
  },

  async listNetworkBookings(take = 5000) {
    return await db.booking.findMany({
      take,
      orderBy: { startTime: "desc" },
      include: {
        user: { select: { id: true, name: true, surname: true } },
        port: {
          include: {
            station: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  async getNetworkBookingById(bookingId: number) {
    return await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { id: true, name: true, surname: true, email: true } },
        vehicle: {
          select: { id: true, licensePlate: true, brand: true, vehicleModel: true },
        },
        port: {
          include: {
            station: { select: { id: true, name: true } },
          },
        },
        sessions: {
          orderBy: { startTime: "desc" },
          include: {
            bill: true,
            port: {
              include: {
                station: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
  },

  async listNetworkSessions(take = 5000) {
    return await db.session.findMany({
      take,
      orderBy: { startTime: "desc" },
      include: {
        user: { select: { id: true, name: true, surname: true } },
        bill: true,
        port: {
          include: {
            station: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  async getNetworkSessionById(sessionId: number) {
    return await db.session.findUnique({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, name: true, surname: true, email: true } },
        vehicle: {
          select: { id: true, licensePlate: true, brand: true, vehicleModel: true },
        },
        bill: true,
        booking: true,
        port: {
          include: {
            station: { select: { id: true, name: true } },
          },
        },
      },
    });
  },
};
