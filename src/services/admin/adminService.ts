import {
    adminRepository,
    buildNetworkListPeriodBillWhere,
    buildNetworkListPeriodBookingWhere,
    buildNetworkListPeriodSessionWhere,
    buildUsersListOrderBy,
    buildUsersListWhere,
    mergeBillWhere,
    mergeBookingWhere,
    mergeSessionWhere,
    type EvUserPublicRow,
} from "../../db/admin/adminRepository.js";
import type {
    AdminUsersSortKey,
    NetworkBookingUiFilter,
    NetworkListPeriod,
    NetworkSessionUiFilter,
    ParsedNetworkBookingsQuery,
    ParsedNetworkPaymentsQuery,
    ParsedNetworkSessionsQuery,
} from "../../lib/pagination.js";
import { HttpError } from "../../lib/httpError.js";
import {
    queryAllAnalyticsViews,
    type AdminAnalyticsViewsPayload,
} from "../../db/admin/adminAnalyticsRepository.js";
import type {
    BookingType,
    EvUser,
    PaymentMethod,
    PaymentStatus,
    SessionStatus,
    UserRole,
} from "../../../generated/prisma/index.js";
import {
    mapBookingStatus,
    mapEvUserDetailToDto,
    type AdminEndUserDto,
} from "./adminUserDetailMapper.js";
import { userService } from "../user/userService.js";

export type AdminNetworkBookingsListResponse = {
    items: AdminNetworkBookingRow[];
    total: number;
    page: number;
    pageSize: number;
};

export type AdminNetworkBookingStatusCounts = Record<NetworkBookingUiFilter, number>;

export type AdminNetworkSessionStatusCounts = Record<NetworkSessionUiFilter, number>;

export type AdminNetworkBookingRow = {
    id: string;
    userId: string | null;
    userName: string;
    stationId: string;
    stationName: string;
    stationCity: string;
    stationCountry: string;
    /** Номер порта на станції (для таблиць без дублювання назви станції). */
    portNumber: number;
    slotLabel: string;
    status: AdminEndUserDto["bookings"][number]["status"];
    start: string;
    end: string;
};

export type AdminBookingSessionSnippet = {
    id: string;
    status: "active" | "completed" | "failed";
    startedAt: string;
    endedAt: string | null;
    kwh: number;
    cost: number | null;
    portLabel: string;
    paymentMethod: string | null;
    paymentStatus: "success" | "pending" | "failed" | null;
};

export type AdminBookingDetailDto = {
    id: string;
    userId: string | null;
    userName: string;
    userEmail: string | null;
    stationId: string;
    stationName: string;
    portNumber: number;
    slotLabel: string;
    status: AdminNetworkBookingRow["status"];
    start: string;
    end: string;
    bookingType: BookingType;
    prepaymentAmount: number;
    createdAt: string;
    vehicle: { id: string; plate: string; model: string } | null;
    /** Сесії зарядки, пов’язані з бронюванням (наприклад після завершення). */
    sessions: AdminBookingSessionSnippet[];
};

export type AdminNetworkSessionRow = {
    id: string;
    userId: string | null;
    userName: string;
    stationId: string;
    stationName: string;
    stationCity: string;
    stationCountry: string;
    portLabel: string;
    status: "active" | "completed" | "failed";
    startedAt: string;
    endedAt: string | null;
    kwh: number;
    cost: number | null;
};

export type AdminNetworkSessionsListResponse = {
    items: AdminNetworkSessionRow[];
    total: number;
    page: number;
    pageSize: number;
};

export type AdminNetworkPaymentsListResponse = {
    items: AdminNetworkPaymentRow[];
    total: number;
    page: number;
    pageSize: number;
};

/** Лічильники за вкладками статусу на сторінці «Платежі». */
export type AdminNetworkPaymentStatusCounts = Record<
    AdminNetworkPaymentRow["status"],
    number
>;

/** Рядок для списку платежів (bill) — узгоджено з клієнтом `PaymentRow`. */
export type AdminNetworkPaymentRow = {
    id: string;
    sessionId: string;
    amount: number;
    currency: string;
    method: string;
    status: "success" | "pending" | "failed";
    createdAt: string;
    description: string;
    userId: string | null;
    userName: string;
};

export type AdminSessionDetailBillDto = {
    id: string;
    calculatedAmount: number;
    pricePerKwhAtTime: number | null;
    paymentMethod: string;
    paymentStatus: "success" | "pending" | "failed";
    paidAt: string | null;
    createdAt: string;
};

export type AdminSessionDetailDto = {
    id: string;
    userId: string | null;
    userName: string;
    userEmail: string | null;
    stationId: string;
    stationName: string;
    portNumber: number;
    portLabel: string;
    status: AdminNetworkSessionRow["status"];
    startedAt: string;
    endedAt: string | null;
    kwh: number;
    vehicle: { id: string; plate: string; model: string } | null;
    booking: {
        id: string;
        status: AdminNetworkBookingRow["status"];
        start: string;
        end: string;
    } | null;
    bill: AdminSessionDetailBillDto | null;
};

function userDisplayName(u: { name: string; surname: string } | null | undefined): string {
    if (!u) return "—";
    const s = `${u.name} ${u.surname}`.trim();
    return s || "—";
}

function mapSessionUiStatus(s: SessionStatus): AdminNetworkSessionRow["status"] {
    switch (s) {
        case "ACTIVE":
            return "active";
        case "COMPLETED":
            return "completed";
        case "FAILED":
            return "failed";
        default:
            return "active";
    }
}

function mapBillPaymentUi(s: PaymentStatus): "success" | "pending" | "failed" {
    switch (s) {
        case "SUCCESS":
            return "success";
        case "PENDING":
            return "pending";
        case "FAILED":
        case "REFUNDED":
            return "failed";
        default:
            return "pending";
    }
}

function paymentMethodUi(m: PaymentMethod): string {
    switch (m) {
        case "CARD":
            return "Картка";
        case "APPLE_PAY":
            return "Apple Pay";
        case "GOOGLE_PAY":
            return "Google Pay";
        default:
            return m;
    }
}

export type AdminUsersRoleCounts = {
    USER: number;
    STATION_ADMIN: number;
    ADMIN: number;
};

export type AdminUsersPageResult = {
    items: EvUserPublicRow[];
    total: number;
    page: number;
    pageSize: number;
    roleCounts: AdminUsersRoleCounts;
};

function mapRoleCounts(row: Record<UserRole, number>): AdminUsersRoleCounts {
    return {
        USER: row.USER,
        STATION_ADMIN: row.STATION_ADMIN,
        ADMIN: row.ADMIN,
    };
}

export const adminService = {
    async getUsersPage(
        skip: number,
        take: number,
        page: number,
        pageSize: number,
        roleFilter?: UserRole | null,
        search?: string | null,
        sort: AdminUsersSortKey = "name",
        order: "asc" | "desc" = "asc"
    ): Promise<AdminUsersPageResult> {
        const where = buildUsersListWhere(roleFilter, search);
        const orderBy = buildUsersListOrderBy(sort, order);
        const [total, items, byRole] = await Promise.all([
            adminRepository.countUsers(where),
            adminRepository.getUsersPage(skip, take, where, orderBy),
            adminRepository.countUsersByRole(),
        ]);
        return {
            items,
            total,
            page,
            pageSize,
            roleCounts: mapRoleCounts(byRole),
        };
    },
    async getUser(userId: number): Promise<AdminEndUserDto> {
        const row = await adminRepository.getUserDetailForAdmin(userId);
        return mapEvUserDetailToDto(row);
    },
    async updateUser(userId: number, body: unknown): Promise<EvUser> {
        return await userService.updateProfileFromBody(userId, body);
    },

    async getNetworkBookingStatusCounts(
        search?: string,
        period: NetworkListPeriod = "all"
    ): Promise<AdminNetworkBookingStatusCounts> {
        const searchWhere = adminRepository.buildNetworkBookingsSearchWhere(search);
        const periodWhere = buildNetworkListPeriodBookingWhere(period);
        const where = mergeBookingWhere(searchWhere, periodWhere);
        const rows = await adminRepository.groupNetworkBookingsByDbStatus(where);
        const out: AdminNetworkBookingStatusCounts = {
            pending: 0,
            confirmed: 0,
            cancelled: 0,
            paid: 0,
        };
        for (const r of rows) {
            const ui = mapBookingStatus(r.status);
            out[ui] += r._count._all;
        }
        return out;
    },

    async getNetworkSessionStatusCounts(
        search?: string,
        period: NetworkListPeriod = "all"
    ): Promise<AdminNetworkSessionStatusCounts> {
        const searchWhere = adminRepository.buildNetworkSessionsSearchWhere(search);
        const periodWhere = buildNetworkListPeriodSessionWhere(period);
        const where = mergeSessionWhere(searchWhere, periodWhere);
        const rows = await adminRepository.groupNetworkSessionsByDbStatus(where);
        const out: AdminNetworkSessionStatusCounts = {
            active: 0,
            completed: 0,
            failed: 0,
        };
        for (const r of rows) {
            const ui = mapSessionUiStatus(r.status);
            out[ui] += r._count._all;
        }
        return out;
    },

    async getNetworkPaymentStatusCounts(
        search?: string,
        period: NetworkListPeriod = "all"
    ): Promise<AdminNetworkPaymentStatusCounts> {
        const searchWhere = adminRepository.buildNetworkBillsSearchWhere(search);
        const periodWhere = buildNetworkListPeriodBillWhere(period);
        const where = mergeBillWhere(searchWhere, periodWhere);
        const rows = await adminRepository.groupNetworkBillsByPaymentStatus(where);
        const out: AdminNetworkPaymentStatusCounts = {
            success: 0,
            pending: 0,
            failed: 0,
        };
        for (const r of rows) {
            const ui = mapBillPaymentUi(r.paymentStatus);
            out[ui] += r._count._all;
        }
        return out;
    },

    async getNetworkBookingsList(
        parsed: ParsedNetworkBookingsQuery
    ): Promise<AdminNetworkBookingsListResponse> {
        const searchWhere = adminRepository.buildNetworkBookingsSearchWhere(parsed.search);
        const statusWhere =
            parsed.status != null
                ? adminRepository.buildNetworkBookingsUiStatusWhere(parsed.status)
                : undefined;
        const periodWhere = buildNetworkListPeriodBookingWhere(parsed.period);
        const where = mergeBookingWhere(
            mergeBookingWhere(searchWhere, statusWhere),
            periodWhere
        );
        const orderBy = adminRepository.networkBookingsOrderBy(parsed.sort, parsed.order);
        const { rows, total } = await adminRepository.listNetworkBookings({
            skip: parsed.skip,
            take: parsed.pageSize,
            ...(where != null ? { where } : {}),
            orderBy,
        });
        const items: AdminNetworkBookingRow[] = rows.map((b) => {
            const st = b.port.station;
            const slotLabel = `${st.name} · порт ${b.portNumber}`;
            return {
                id: String(b.id),
                userId: b.userId != null ? String(b.userId) : null,
                userName: userDisplayName(b.user),
                stationId: String(b.stationId),
                stationName: st.name,
                stationCity: st.location.city,
                stationCountry: st.location.country,
                portNumber: b.portNumber,
                slotLabel,
                status: mapBookingStatus(b.status),
                start: b.startTime.toISOString(),
                end: b.endTime.toISOString(),
            };
        });
        return {
            items,
            total,
            page: parsed.page,
            pageSize: parsed.pageSize,
        };
    },

    async getNetworkSessionsList(
        parsed: ParsedNetworkSessionsQuery
    ): Promise<AdminNetworkSessionsListResponse> {
        const searchWhere = adminRepository.buildNetworkSessionsSearchWhere(parsed.search);
        const statusWhere =
            parsed.status != null
                ? adminRepository.buildNetworkSessionsUiStatusWhere(parsed.status)
                : undefined;
        const periodWhere = buildNetworkListPeriodSessionWhere(parsed.period);
        const where = mergeSessionWhere(
            mergeSessionWhere(searchWhere, statusWhere),
            periodWhere
        );
        const orderBy = adminRepository.networkSessionsOrderBy(parsed.sort, parsed.order);
        const { rows, total } = await adminRepository.listNetworkSessions({
            skip: parsed.skip,
            take: parsed.pageSize,
            ...(where != null ? { where } : {}),
            orderBy,
        });
        const items: AdminNetworkSessionRow[] = rows.map((s) => {
            const st = s.port.station;
            return {
                id: String(s.id),
                userId: s.userId != null ? String(s.userId) : null,
                userName: userDisplayName(s.user),
                stationId: String(s.stationId),
                stationName: st.name,
                stationCity: st.location.city,
                stationCountry: st.location.country,
                portLabel: `Порт ${s.portNumber}`,
                status: mapSessionUiStatus(s.status),
                startedAt: s.startTime.toISOString(),
                endedAt: s.endTime ? s.endTime.toISOString() : null,
                kwh: Number(s.kwhConsumed),
                cost: s.bill != null ? Number(s.bill.calculatedAmount) : null,
            };
        });
        return {
            items,
            total,
            page: parsed.page,
            pageSize: parsed.pageSize,
        };
    },

    async getNetworkPaymentsList(
        parsed: ParsedNetworkPaymentsQuery
    ): Promise<AdminNetworkPaymentsListResponse> {
        const searchWhere = adminRepository.buildNetworkBillsSearchWhere(parsed.search);
        const statusWhere =
            parsed.status != null
                ? adminRepository.buildNetworkBillsUiStatusWhere(parsed.status)
                : undefined;
        const periodWhere = buildNetworkListPeriodBillWhere(parsed.period);
        const where = mergeBillWhere(mergeBillWhere(searchWhere, statusWhere), periodWhere);
        const orderBy = adminRepository.networkBillsOrderBy(parsed.sort, parsed.order);
        const { rows, total } = await adminRepository.listNetworkBillsPaged({
            skip: parsed.skip,
            take: parsed.pageSize,
            ...(where != null ? { where } : {}),
            orderBy,
        });
        const items: AdminNetworkPaymentRow[] = rows.map((bill) => {
            const s = bill.session;
            const st = s.port.station;
            const uid = s.userId != null ? String(s.userId) : null;
            return {
                id: String(bill.id),
                sessionId: String(s.id),
                amount: Number(bill.calculatedAmount),
                currency: "UAH",
                method: paymentMethodUi(bill.paymentMethod),
                status: mapBillPaymentUi(bill.paymentStatus),
                createdAt: bill.createdAt.toISOString(),
                description: `Сесія #${s.id} · ${st.name}`,
                userId: uid,
                userName: userDisplayName(s.user),
            };
        });
        return {
            items,
            total,
            page: parsed.page,
            pageSize: parsed.pageSize,
        };
    },

    async cancelNetworkBooking(bookingId: number): Promise<AdminBookingDetailDto> {
        try {
            await adminRepository.cancelNetworkBooking(bookingId);
        } catch (e) {
            if (e instanceof Error) {
                if (e.message === "BOOKING_NOT_FOUND") {
                    throw new HttpError(404, "Бронювання не знайдено.");
                }
                if (e.message === "BOOKING_NOT_CANCELLABLE") {
                    throw new HttpError(
                        409,
                        "Це бронювання не можна скасувати (вже завершено, оплачено або скасовано)."
                    );
                }
                if (e.message === "BOOKING_ACTIVE_SESSION") {
                    throw new HttpError(
                        409,
                        "Спочатку завершіть активну сесію зарядки за цим бронюванням."
                    );
                }
            }
            throw e;
        }
        const dto = await this.getNetworkBookingById(bookingId);
        if (!dto) {
            throw new HttpError(500, "Не вдалося завантажити бронювання після скасування.");
        }
        return dto;
    },

    async getNetworkBookingById(bookingId: number): Promise<AdminBookingDetailDto | null> {
        const b = await adminRepository.getNetworkBookingById(bookingId);
        if (!b) return null;
        const st = b.port.station;
        const slotLabel = `${st.name} · порт ${b.portNumber}`;
        return {
            id: String(b.id),
            userId: b.userId != null ? String(b.userId) : null,
            userName: userDisplayName(b.user),
            userEmail: b.user?.email ?? null,
            stationId: String(b.stationId),
            stationName: st.name,
            portNumber: b.portNumber,
            slotLabel,
            status: mapBookingStatus(b.status),
            start: b.startTime.toISOString(),
            end: b.endTime.toISOString(),
            bookingType: b.bookingType,
            prepaymentAmount: Number(b.prepaymentAmount),
            createdAt: b.createdAt.toISOString(),
            vehicle: b.vehicle
                ? {
                      id: String(b.vehicle.id),
                      plate: b.vehicle.licensePlate,
                      model: `${b.vehicle.brand} ${b.vehicle.vehicleModel}`.trim(),
                  }
                : null,
            sessions: b.sessions.map((s) => {
                const st = s.port.station;
                return {
                    id: String(s.id),
                    status: mapSessionUiStatus(s.status),
                    startedAt: s.startTime.toISOString(),
                    endedAt: s.endTime ? s.endTime.toISOString() : null,
                    kwh: Number(s.kwhConsumed),
                    cost: s.bill != null ? Number(s.bill.calculatedAmount) : null,
                    portLabel: `${st.name} · порт ${s.portNumber}`,
                    paymentMethod: s.bill != null ? paymentMethodUi(s.bill.paymentMethod) : null,
                    paymentStatus: s.bill != null ? mapBillPaymentUi(s.bill.paymentStatus) : null,
                };
            }),
        };
    },

    async getNetworkSessionById(sessionId: number): Promise<AdminSessionDetailDto | null> {
        const s = await adminRepository.getNetworkSessionById(sessionId);
        if (!s) return null;
        const st = s.port.station;
        return {
            id: String(s.id),
            userId: s.userId != null ? String(s.userId) : null,
            userName: userDisplayName(s.user),
            userEmail: s.user?.email ?? null,
            stationId: String(s.stationId),
            stationName: st.name,
            portNumber: s.portNumber,
            portLabel: `${st.name} · порт ${s.portNumber}`,
            status: mapSessionUiStatus(s.status),
            startedAt: s.startTime.toISOString(),
            endedAt: s.endTime ? s.endTime.toISOString() : null,
            kwh: Number(s.kwhConsumed),
            vehicle: s.vehicle
                ? {
                      id: String(s.vehicle.id),
                      plate: s.vehicle.licensePlate,
                      model: `${s.vehicle.brand} ${s.vehicle.vehicleModel}`.trim(),
                  }
                : null,
            booking: s.booking
                ? {
                      id: String(s.booking.id),
                      status: mapBookingStatus(s.booking.status),
                      start: s.booking.startTime.toISOString(),
                      end: s.booking.endTime.toISOString(),
                  }
                : null,
            bill: s.bill
                ? {
                      id: String(s.bill.id),
                      calculatedAmount: Number(s.bill.calculatedAmount),
                      pricePerKwhAtTime:
                          s.bill.pricePerKwhAtTime != null ? Number(s.bill.pricePerKwhAtTime) : null,
                      paymentMethod: paymentMethodUi(s.bill.paymentMethod),
                      paymentStatus: mapBillPaymentUi(s.bill.paymentStatus),
                      paidAt: s.bill.paidAt ? s.bill.paidAt.toISOString() : null,
                      createdAt: s.bill.createdAt.toISOString(),
                  }
                : null,
        };
    },

    async completeNetworkSession(
        sessionId: number,
        kwhConsumed?: number
    ): Promise<AdminSessionDetailDto> {
        try {
            await adminRepository.completeActiveNetworkSession(sessionId, kwhConsumed);
        } catch (e) {
            if (e instanceof Error) {
                if (e.message === "SESSION_NOT_ACTIVE") {
                    throw new HttpError(
                        409,
                        "Сесію не можна завершити: вона не активна або вже завершена."
                    );
                }
                if (e.message === "SESSION_NOT_FOUND") {
                    throw new HttpError(404, "Сесію не знайдено.");
                }
            }
            throw e;
        }
        const dto = await this.getNetworkSessionById(sessionId);
        if (!dto) {
            throw new HttpError(500, "Не вдалося завантажити сесію після завершення.");
        }
        return dto;
    },

    async getDashboardSummary(): Promise<{
        todaySessions: number;
        todayRevenueUah: number;
        todaySuccessfulPayments: number;
        activeSessions: number;
    }> {
        return adminRepository.getDashboardNetworkStats();
    },

    async getAnalyticsViews(): Promise<AdminAnalyticsViewsPayload> {
        return queryAllAnalyticsViews();
    },
}   