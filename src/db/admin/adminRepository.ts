import prisma from "../../prisma.config.js";
import type { Prisma, PrismaClient, UserRole } from "../../../generated/prisma/index.js";

const ALL_USER_ROLES: UserRole[] = ["USER", "STATION_ADMIN", "ADMIN"];
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
  async countUsers(where?: Prisma.EvUserWhereInput): Promise<number> {
    return db.evUser.count({ where: where ?? {} });
  },

  /** Кількості по ролях (усі записи в БД). */
  async countUsersByRole(): Promise<Record<UserRole, number>> {
    const rows = await db.evUser.groupBy({
      by: ["role"],
      _count: { _all: true },
    });
    const out = Object.fromEntries(ALL_USER_ROLES.map((r) => [r, 0])) as Record<UserRole, number>;
    for (const r of rows) {
      out[r.role] = r._count._all;
    }
    return out;
  },

  async getUsersPage(
    skip: number,
    take: number,
    where?: Prisma.EvUserWhereInput
  ): Promise<EvUserPublicRow[]> {
    return await db.evUser.findMany({
      where: where ?? {},
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

  /** Агрегати за поточну календарну добу (часовий пояс процесу Node). */
  async getDashboardNetworkStats(): Promise<{
    todaySessions: number;
    todayRevenueUah: number;
    todaySuccessfulPayments: number;
  }> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const billTodayWhere: Prisma.BillWhereInput = {
      paymentStatus: "SUCCESS",
      OR: [
        { paidAt: { gte: start, lte: end } },
        { paidAt: null, createdAt: { gte: start, lte: end } },
      ],
    };

    const [todaySessions, revenueAgg, todaySuccessfulPayments] = await Promise.all([
      db.session.count({
        where: { startTime: { gte: start, lte: end } },
      }),
      db.bill.aggregate({
        where: billTodayWhere,
        _sum: { calculatedAmount: true },
      }),
      db.bill.count({ where: billTodayWhere }),
    ]);

    const todayRevenueUah =
      revenueAgg._sum.calculatedAmount != null ? Number(revenueAgg._sum.calculatedAmount) : 0;

    return { todaySessions, todayRevenueUah, todaySuccessfulPayments };
  },
};
