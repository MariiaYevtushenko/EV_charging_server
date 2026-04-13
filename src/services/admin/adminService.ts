import { adminRepository, type EvUserPublicRow } from "../../db/admin/adminRepository.js";
import type {
    BookingType,
    EvUser,
    PaymentMethod,
    PaymentStatus,
    SessionStatus,
} from "../../../generated/prisma/index.js";
import {
    mapBookingStatus,
    mapEvUserDetailToDto,
    type AdminEndUserDto,
} from "./adminUserDetailMapper.js";
import { userService } from "../user/userService.js";

export type AdminNetworkBookingRow = {
    id: string;
    userId: string | null;
    userName: string;
    stationId: string;
    stationName: string;
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
    portLabel: string;
    status: "active" | "completed" | "failed";
    startedAt: string;
    endedAt: string | null;
    kwh: number;
    cost: number | null;
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

export type AdminUsersPageResult = {
    items: EvUserPublicRow[];
    total: number;
    page: number;
    pageSize: number;
};

export const adminService = {
    async getUsersPage(
        skip: number,
        take: number,
        page: number,
        pageSize: number
    ): Promise<AdminUsersPageResult> {
        const [total, items] = await Promise.all([
            adminRepository.countUsers(),
            adminRepository.getUsersPage(skip, take),
        ]);
        return { items, total, page, pageSize };
    },
    async getUser(userId: number): Promise<AdminEndUserDto> {
        const row = await adminRepository.getUserDetailForAdmin(userId);
        return mapEvUserDetailToDto(row);
    },
    async updateUser(userId: number, body: unknown): Promise<EvUser> {
        return await userService.updateProfileFromBody(userId, body);
    },

    async getNetworkBookings(): Promise<AdminNetworkBookingRow[]> {
        const rows = await adminRepository.listNetworkBookings();
        return rows.map((b) => {
            const st = b.port.station;
            const slotLabel = `${st.name} · порт ${b.portNumber}`;
            return {
                id: String(b.id),
                userId: b.userId != null ? String(b.userId) : null,
                userName: userDisplayName(b.user),
                stationId: String(b.stationId),
                stationName: st.name,
                slotLabel,
                status: mapBookingStatus(b.status),
                start: b.startTime.toISOString(),
                end: b.endTime.toISOString(),
            };
        });
    },

    async getNetworkSessions(): Promise<AdminNetworkSessionRow[]> {
        const rows = await adminRepository.listNetworkSessions();
        return rows.map((s) => {
            const st = s.port.station;
            return {
                id: String(s.id),
                userId: s.userId != null ? String(s.userId) : null,
                userName: userDisplayName(s.user),
                stationId: String(s.stationId),
                stationName: st.name,
                portLabel: `Порт ${s.portNumber}`,
                status: mapSessionUiStatus(s.status),
                startedAt: s.startTime.toISOString(),
                endedAt: s.endTime ? s.endTime.toISOString() : null,
                kwh: Number(s.kwhConsumed),
                cost: s.bill != null ? Number(s.bill.calculatedAmount) : null,
            };
        });
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
}   