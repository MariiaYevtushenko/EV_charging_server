import prisma from "../../prisma.config.js";
import { callCreateFinalBillPending } from "../sql/proceduresRepository.js";
import type { Prisma, PrismaClient, UserRole } from "../../../generated/prisma/index.js";
import type {
  AdminUsersSortKey,
  NetworkBookingUiFilter,
  NetworkBookingsSortKey,
  NetworkListPeriod,
  NetworkPaymentUiFilter,
  NetworkPaymentsSortKey,
  NetworkSessionUiFilter,
  NetworkSessionsSortKey,
} from "../../lib/pagination.js";

const ALL_USER_ROLES: UserRole[] = ["USER", "STATION_ADMIN", "ADMIN"];
import { adminUserDetailInclude } from "../../services/admin/adminUserDetailMapper.js";

const db = prisma as unknown as PrismaClient;

export function mergeBookingWhere(
  a?: Prisma.BookingWhereInput,
  b?: Prisma.BookingWhereInput
): Prisma.BookingWhereInput | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return { AND: [a, b] };
}

export function mergeSessionWhere(
  a?: Prisma.SessionWhereInput,
  b?: Prisma.SessionWhereInput
): Prisma.SessionWhereInput | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return { AND: [a, b] };
}

export function mergeBillWhere(
  a?: Prisma.BillWhereInput,
  b?: Prisma.BillWhereInput
): Prisma.BillWhereInput | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return { AND: [a, b] };
}

export function buildNetworkListPeriodBookingWhere(
  period: NetworkListPeriod
): Prisma.BookingWhereInput | undefined {
  if (period === "all") return undefined;
  const days = period === "7d" ? 7 : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { startTime: { gte: cutoff } };
}

export function buildNetworkListPeriodSessionWhere(
  period: NetworkListPeriod
): Prisma.SessionWhereInput | undefined {
  if (period === "all") return undefined;
  const days = period === "7d" ? 7 : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { startTime: { gte: cutoff } };
}

export function buildNetworkListPeriodBillWhere(
  period: NetworkListPeriod
): Prisma.BillWhereInput | undefined {
  if (period === "all") return undefined;
  const days = period === "7d" ? 7 : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { createdAt: { gte: cutoff } };
}

/** Фільтр списку користувачів: роль + текстовий пошук (ПІБ, email, телефон). */
export function buildUsersListWhere(
  roleFilter?: UserRole | null,
  search?: string | null
): Prisma.EvUserWhereInput | undefined {
  const q = (search ?? "").trim();
  const searchWhere: Prisma.EvUserWhereInput | undefined =
    q.length === 0
      ? undefined
      : {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { surname: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phoneNumber: { contains: q, mode: "insensitive" } },
          ],
        };
  const roleWhere: Prisma.EvUserWhereInput | undefined =
    roleFilter != null ? { role: roleFilter } : undefined;
  if (!roleWhere && !searchWhere) return undefined;
  if (roleWhere && !searchWhere) return roleWhere;
  if (!roleWhere && searchWhere) return searchWhere;
  return { AND: [roleWhere!, searchWhere!] };
}

/** ORDER BY для списку користувачів (узгоджено з колонками таблиці). */
export function buildUsersListOrderBy(
  sort: AdminUsersSortKey,
  order: "asc" | "desc"
): Prisma.EvUserOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ surname: order }, { name: order }, { id: "asc" }];
    case "email":
      return [{ email: order }, { id: "asc" }];
    case "phone":
      return [{ phoneNumber: order }, { id: "asc" }];
    case "role":
      return [{ role: order }, { id: "asc" }];
    default:
      return [{ surname: "asc" }, { name: "asc" }, { id: "asc" }];
  }
}

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
    where?: Prisma.EvUserWhereInput,
    orderBy?: Prisma.EvUserOrderByWithRelationInput | Prisma.EvUserOrderByWithRelationInput[]
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
      orderBy: orderBy ?? { id: "asc" },
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

  /** Текстовий пошук по бронюванню (користувач, станція, локація) та за id. */
  buildNetworkBookingsSearchWhere(search?: string | null): Prisma.BookingWhereInput | undefined {
    const q = (search ?? "").trim();
    if (q.length === 0) return undefined;

    const idNum = Number.parseInt(q, 10);
    const idOnlyDigits = /^\d+$/.test(q);
    const idClause: Prisma.BookingWhereInput | undefined =
      idOnlyDigits && Number.isFinite(idNum) && idNum >= 1 ? { id: idNum } : undefined;

    const textOr: Prisma.BookingWhereInput[] = [
      { user: { name: { contains: q, mode: "insensitive" } } },
      { user: { surname: { contains: q, mode: "insensitive" } } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { port: { station: { name: { contains: q, mode: "insensitive" } } } },
      { port: { station: { location: { city: { contains: q, mode: "insensitive" } } } } },
      { port: { station: { location: { country: { contains: q, mode: "insensitive" } } } } },
    ];

    if (idClause) {
      return { OR: [idClause, ...textOr] };
    }
    return { OR: textOr };
  },

  /** Фільтр за статусом у UI (узгоджено з mapBookingStatus). «Підтверджено» в БД не виділено — порожній результат. */
  buildNetworkBookingsUiStatusWhere(ui: NetworkBookingUiFilter): Prisma.BookingWhereInput {
    switch (ui) {
      case "pending":
        return { status: "BOOKED" };
      case "paid":
        return { status: "COMPLETED" };
      case "cancelled":
        return { status: "CANCELLED" };
      case "missed":
        return { status: "MISSED" };
      case "confirmed":
        return { id: { equals: 0 } };
      default:
        return {};
    }
  },

  networkBookingsOrderBy(
    sort: NetworkBookingsSortKey,
    order: "asc" | "desc"
  ): Prisma.BookingOrderByWithRelationInput {
    switch (sort) {
      case "start":
        return { startTime: order };
      case "userName":
        return { user: { name: order } };
      case "stationName":
        return { port: { station: { name: order } } };
      case "slot":
        return { portNumber: order };
      case "status":
        return { status: order };
      default:
        return { startTime: "desc" };
    }
  },

  async listNetworkBookings(params: {
    skip: number;
    take: number;
    where?: Prisma.BookingWhereInput;
    orderBy: Prisma.BookingOrderByWithRelationInput;
  }) {
    const where = params.where ?? {};
    const [rows, total] = await Promise.all([
      db.booking.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: {
          user: { select: { id: true, name: true, surname: true } },
          port: {
            include: {
              station: {
                select: {
                  id: true,
                  name: true,
                  location: { select: { city: true, country: true } },
                },
              },
            },
          },
        },
      }),
      db.booking.count({ where }),
    ]);
    return { rows, total };
  },

  /**
   * Скасувати бронювання (лише BOOKED, без активної сесії).
   * @throws Error з кодами: BOOKING_NOT_FOUND | BOOKING_NOT_CANCELLABLE | BOOKING_ACTIVE_SESSION
   */
  async cancelNetworkBooking(bookingId: number): Promise<void> {
    const existing = await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        sessions: {
          where: { status: "ACTIVE" },
          select: { id: true },
        },
      },
    });
    if (!existing) {
      throw new Error("BOOKING_NOT_FOUND");
    }
    if (existing.status !== "BOOKED") {
      throw new Error("BOOKING_NOT_CANCELLABLE");
    }
    if (existing.sessions.length > 0) {
      throw new Error("BOOKING_ACTIVE_SESSION");
    }
    await db.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
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
            station: {
              select: {
                id: true,
                name: true,
                location: { select: { city: true, country: true } },
              },
            },
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

  buildNetworkSessionsSearchWhere(search?: string | null): Prisma.SessionWhereInput | undefined {
    const q = (search ?? "").trim();
    if (q.length === 0) return undefined;

    const idNum = Number.parseInt(q, 10);
    const idOnlyDigits = /^\d+$/.test(q);
    const idClause: Prisma.SessionWhereInput | undefined =
      idOnlyDigits && Number.isFinite(idNum) && idNum >= 1 ? { id: idNum } : undefined;

    const textOr: Prisma.SessionWhereInput[] = [
      { user: { name: { contains: q, mode: "insensitive" } } },
      { user: { surname: { contains: q, mode: "insensitive" } } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { port: { station: { name: { contains: q, mode: "insensitive" } } } },
      { port: { station: { location: { city: { contains: q, mode: "insensitive" } } } } },
      { port: { station: { location: { country: { contains: q, mode: "insensitive" } } } } },
    ];

    if (idClause) {
      return { OR: [idClause, ...textOr] };
    }
    return { OR: textOr };
  },

  buildNetworkSessionsUiStatusWhere(ui: NetworkSessionUiFilter): Prisma.SessionWhereInput {
    switch (ui) {
      case "active":
        return { status: "ACTIVE" };
      case "completed":
        return { status: "COMPLETED" };
      case "failed":
        return { status: "FAILED" };
      default:
        return {};
    }
  },

  /** Текстовий пошук по рахунку (bill id, session id, користувач, станція). */
  buildNetworkBillsSearchWhere(search?: string | null): Prisma.BillWhereInput | undefined {
    const q = (search ?? "").trim();
    if (q.length === 0) return undefined;

    const idNum = Number.parseInt(q, 10);
    const idOnlyDigits = /^\d+$/.test(q);
    const billIdClause: Prisma.BillWhereInput | undefined =
      idOnlyDigits && Number.isFinite(idNum) && idNum >= 1 ? { id: idNum } : undefined;
    const sessionIdClause: Prisma.BillWhereInput | undefined =
      idOnlyDigits && Number.isFinite(idNum) && idNum >= 1 ? { sessionId: idNum } : undefined;

    const textOr: Prisma.BillWhereInput[] = [
      { session: { user: { name: { contains: q, mode: "insensitive" } } } },
      { session: { user: { surname: { contains: q, mode: "insensitive" } } } },
      { session: { user: { email: { contains: q, mode: "insensitive" } } } },
      { session: { port: { station: { name: { contains: q, mode: "insensitive" } } } } },
    ];

    const clauses: Prisma.BillWhereInput[] = [...textOr];
    if (billIdClause) clauses.push(billIdClause);
    if (sessionIdClause) clauses.push(sessionIdClause);
    return { OR: clauses };
  },

  buildNetworkBillsUiStatusWhere(ui: NetworkPaymentUiFilter): Prisma.BillWhereInput {
    switch (ui) {
      case "success":
        return { paymentStatus: "SUCCESS" };
      case "pending":
        return { paymentStatus: "PENDING" };
      case "failed":
        return { paymentStatus: { in: ["FAILED", "REFUNDED"] } };
      default:
        return {};
    }
  },

  networkBillsOrderBy(
    sort: NetworkPaymentsSortKey,
    order: "asc" | "desc"
  ): Prisma.BillOrderByWithRelationInput {
    switch (sort) {
      case "createdAt":
        return { createdAt: order };
      case "userName":
        return { session: { user: { name: order } } };
      case "sessionId":
        return { session: { id: order } };
      case "method":
        return { paymentMethod: order };
      case "amount":
        return { calculatedAmount: order };
      case "status":
        return { paymentStatus: order };
      default:
        return { createdAt: "desc" };
    }
  },

  networkSessionsOrderBy(
    sort: NetworkSessionsSortKey,
    order: "asc" | "desc"
  ): Prisma.SessionOrderByWithRelationInput {
    switch (sort) {
      case "startedAt":
        return { startTime: order };
      case "userName":
        return { user: { name: order } };
      case "stationName":
        return { port: { station: { name: order } } };
      case "portLabel":
        return { portNumber: order };
      case "kwh":
        return { kwhConsumed: order };
      case "status":
        return { status: order };
      case "cost":
        return { bill: { calculatedAmount: order } };
      default:
        return { startTime: "desc" };
    }
  },

  async listNetworkSessions(params: {
    skip: number;
    take: number;
    where?: Prisma.SessionWhereInput;
    orderBy: Prisma.SessionOrderByWithRelationInput;
  }) {
    const where = params.where ?? {};
    const include = {
      user: { select: { id: true, name: true, surname: true } },
      bill: true,
      port: {
        include: {
          station: {
            select: {
              id: true,
              name: true,
              location: { select: { city: true, country: true } },
            },
          },
        },
      },
    };
    const [rows, total] = await Promise.all([
      db.session.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include,
      }),
      db.session.count({ where }),
    ]);
    return { rows, total };
  },

  async groupNetworkBookingsByDbStatus(where?: Prisma.BookingWhereInput) {
    return await db.booking.groupBy({
      by: ["status"],
      where: where ?? {},
      _count: { _all: true },
    });
  },

  async groupNetworkSessionsByDbStatus(where?: Prisma.SessionWhereInput) {
    return await db.session.groupBy({
      by: ["status"],
      where: where ?? {},
      _count: { _all: true },
    });
  },

  async groupNetworkBillsByPaymentStatus(where?: Prisma.BillWhereInput) {
    return await db.bill.groupBy({
      by: ["paymentStatus"],
      where: where ?? {},
      _count: { _all: true },
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

  /**
   * Завершити активну сесію: COMPLETED, end_time, kwh; створити/оновити bill через SQL CreateFinalBill.
   */
  async completeActiveNetworkSession(sessionId: number, kwhConsumed?: number): Promise<void> {
    await db.$transaction(async (tx) => {
      const active = await tx.session.findFirst({
        where: { id: sessionId, status: "ACTIVE" },
      });
      if (!active) {
        const exists = await tx.session.findUnique({
          where: { id: sessionId },
          select: { id: true },
        });
        throw new Error(exists ? "SESSION_NOT_ACTIVE" : "SESSION_NOT_FOUND");
      }
      const finalKwh =
        kwhConsumed !== undefined && Number.isFinite(kwhConsumed) && kwhConsumed >= 0
          ? kwhConsumed
          : Number(active.kwhConsumed);

      await tx.session.update({
        where: { id: sessionId },
        data: {
          endTime: new Date(),
          kwhConsumed: finalKwh,
          status: "COMPLETED",
        },
      });

      await callCreateFinalBillPending(tx, sessionId);
    });
  },

  async listNetworkBillsPaged(params: {
    skip: number;
    take: number;
    where?: Prisma.BillWhereInput;
    orderBy: Prisma.BillOrderByWithRelationInput;
  }) {
    const where = params.where ?? {};
    const include = {
      session: {
        include: {
          user: { select: { id: true, name: true, surname: true } },
          port: {
            include: {
              station: { select: { id: true, name: true } },
            },
          },
        },
      },
    };
    const [rows, total] = await Promise.all([
      db.bill.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include,
      }),
      db.bill.count({ where }),
    ]);
    return { rows, total };
  },

  /** Агрегати за поточну календарну добу (часовий пояс процесу Node) + активні сесії зараз. */
  async getDashboardNetworkStats(): Promise<{
    todaySessions: number;
    todayRevenueUah: number;
    todaySuccessfulPayments: number;
    activeSessions: number;
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

    const [todaySessions, revenueAgg, todaySuccessfulPayments, activeSessions] = await Promise.all([
      db.session.count({
        where: { startTime: { gte: start, lte: end } },
      }),
      db.bill.aggregate({
        where: billTodayWhere,
        _sum: { calculatedAmount: true },
      }),
      db.bill.count({ where: billTodayWhere }),
      db.session.count({ where: { status: "ACTIVE" } }),
    ]);

    const todayRevenueUah =
      revenueAgg._sum.calculatedAmount != null ? Number(revenueAgg._sum.calculatedAmount) : 0;

    return { todaySessions, todayRevenueUah, todaySuccessfulPayments, activeSessions };
  },
};
