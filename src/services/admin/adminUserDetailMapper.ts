import type { Prisma } from "../../../generated/prisma/index.js";
import type {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
} from "../../../generated/prisma/index.js";

/** JSON для клієнта (відповідає `EndUser` у client/src/types/globalAdmin.ts). */
export type AdminEndUserDto = {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Роль у БД (Prisma `UserRole`). */
  role: "USER" | "STATION_ADMIN" | "ADMIN";
  balance: number;
  registeredAt: string;
  avatarUrl?: string;
  blocked?: boolean;
  cars: {
    id: string;
    plate: string;
    model: string;
    connector: string;
  }[];
  bookings: {
    id: string;
    stationId: string;
    stationName: string;
    slotLabel: string;
    status: "pending" | "confirmed" | "cancelled" | "completed";
    start: string;
    end: string;
  }[];
  payments: {
    id: string;
    amount: number;
    currency: string;
    method: string;
    status: "success" | "pending" | "failed";
    createdAt: string;
    description: string;
  }[];
  charges: {
    id: string;
    stationId: string;
    stationName: string;
    kwh: number;
    cost: number;
    startedAt: string;
    durationMin: number;
    portLabel: string;
  }[];
};

export const adminUserDetailInclude = {
  vehicles: { orderBy: { id: "asc" as const } },
  bookings: {
    orderBy: { startTime: "desc" as const },
    include: {
      port: {
        include: {
          station: { select: { id: true, name: true } },
        },
      },
    },
  },
  sessions: {
    orderBy: { startTime: "desc" as const },
    include: {
      port: {
        include: {
          station: { select: { id: true, name: true } },
          connectorType: { select: { name: true } },
        },
      },
      bill: true,
    },
  },
} satisfies Prisma.EvUserInclude;

export type EvUserDetailPayload = Prisma.EvUserGetPayload<{
  include: typeof adminUserDetailInclude;
}>;

/** У БД лише BOOKED / PAID / CANCELLED: BOOKED → очікує (активне бронювання), PAID → завершено. */
export function mapBookingStatus(s: BookingStatus): AdminEndUserDto["bookings"][number]["status"] {
  switch (s) {
    case "BOOKED":
      return "pending";
    case "PAID":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "pending";
  }
}

function mapPaymentStatus(s: PaymentStatus): AdminEndUserDto["payments"][number]["status"] {
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

function paymentMethodLabel(m: PaymentMethod): string {
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

function connectorCategoryLabel(name: string | null | undefined): string {
  if (!name) return "—";
  const map: Record<string, string> = {
    TYPE_2: "Type 2",
    CCS_2: "CCS 2",
    CHADEMO: "CHAdeMO",
    TESLA_SUPERCHARGER: "Tesla",
  };
  if (map[name]) return map[name];
  return name
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function mapEvUserDetailToDto(user: EvUserDetailPayload): AdminEndUserDto {
  const fullName = `${user.name} ${user.surname}`.trim();

  const sessions = user.sessions;

  const connectorByVehicleId = new Map<number, string>();
  for (const s of sessions) {
    if (s.vehicleId == null) continue;
    if (connectorByVehicleId.has(s.vehicleId)) continue;
    const cat = s.port.connectorType?.name;
    connectorByVehicleId.set(s.vehicleId, connectorCategoryLabel(cat ?? null));
  }

  const cars: AdminEndUserDto["cars"] = user.vehicles.map((v) => ({
    id: String(v.id),
    plate: v.licensePlate,
    model: `${v.brand} ${v.vehicleModel}`.trim(),
    connector: connectorByVehicleId.get(v.id) ?? "—",
  }));

  const bookings: AdminEndUserDto["bookings"] = user.bookings.map((b) => {
    const st = b.port.station;
    const slotLabel = `${st.name} · порт ${b.portNumber}`;
    return {
      id: String(b.id),
      stationId: String(b.stationId),
      stationName: st.name,
      slotLabel,
      status: mapBookingStatus(b.status),
      start: b.startTime.toISOString(),
      end: b.endTime.toISOString(),
    };
  });

  const payments: AdminEndUserDto["payments"] = sessions
    .filter((s) => s.bill != null)
    .map((s) => {
      const bill = s.bill!;
      return {
        id: String(bill.id),
        amount: Number(bill.calculatedAmount),
        currency: "UAH",
        method: paymentMethodLabel(bill.paymentMethod),
        status: mapPaymentStatus(bill.paymentStatus),
        createdAt: bill.createdAt.toISOString(),
        description: `Сесія #${s.id}`,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const charges: AdminEndUserDto["charges"] = sessions.map((s) => {
    const st = s.port.station;
    const end = s.endTime;
    const start = s.startTime;
    const durationMin =
      end && start
        ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
        : 0;
    const cost = s.bill ? Number(s.bill.calculatedAmount) : 0;
    return {
      id: String(s.id),
      stationId: String(s.stationId),
      stationName: st.name,
      kwh: Number(s.kwhConsumed),
      cost,
      startedAt: s.startTime.toISOString(),
      durationMin,
      portLabel: `Порт ${s.portNumber}`,
    };
  });

  return {
    id: String(user.id),
    name: fullName,
    email: user.email,
    phone: user.phoneNumber,
    role: user.role,
    balance: 0,
    registeredAt: user.createdAt.toISOString(),
    blocked: false,
    cars,
    bookings,
    payments,
    charges,
  };
}
