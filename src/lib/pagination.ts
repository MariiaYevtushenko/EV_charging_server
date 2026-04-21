export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** Список бронювань у глобальній адмінці — більший верхній ліміт сторінки. */
export const ADMIN_NETWORK_BOOKINGS_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_NETWORK_BOOKINGS_MAX_PAGE_SIZE = 2000;

export type ParsedPagination = {
  page: number;
  pageSize: number;
  skip: number;
};

export function parsePaginationQuery(query: Record<string, unknown>): ParsedPagination {
  const rawPage = Number(query["page"]);
  const rawSize = Number(query["pageSize"]);

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  let pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.floor(rawSize) : DEFAULT_PAGE_SIZE;
  pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));

  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip };
}

/** Період для списків бронювань / сесій / платежів (глобальна адмінка). */
export type NetworkListPeriod = "7d" | "30d" | "all";

const NETWORK_LIST_PERIODS: readonly NetworkListPeriod[] = ["7d", "30d", "all"];

export function parseNetworkListPeriod(raw: unknown): NetworkListPeriod {
  if (typeof raw === "string" && NETWORK_LIST_PERIODS.includes(raw as NetworkListPeriod)) {
    return raw as NetworkListPeriod;
  }
  return "all";
}

/** Спільні `q` + `period` для лічильників за статусом. */
export function parseNetworkListStatusCountsQuery(query: Record<string, unknown>): {
  search?: string;
  period: NetworkListPeriod;
} {
  const rawQ = query["q"];
  const search =
    typeof rawQ === "string" && rawQ.trim() !== "" ? rawQ.trim() : undefined;
  const period = parseNetworkListPeriod(query["period"]);
  return {
    ...(search !== undefined ? { search } : {}),
    period,
  };
}

export type NetworkBookingsSortKey = "start" | "userName" | "stationName" | "slot" | "status";

/** Фільтр списку бронювань (як у UI). */
export type NetworkBookingUiFilter = "pending" | "confirmed" | "cancelled" | "paid" | "missed";

const NETWORK_BOOKING_UI_FILTERS: readonly NetworkBookingUiFilter[] = [
  "pending",
  "confirmed",
  "cancelled",
  "paid",
  "missed",
];

export type ParsedNetworkBookingsQuery = {
  page: number;
  pageSize: number;
  skip: number;
  search?: string;
  status?: NetworkBookingUiFilter;
  sort: NetworkBookingsSortKey;
  order: "asc" | "desc";
  period: NetworkListPeriod;
};

const NETWORK_BOOKINGS_SORT_KEYS: readonly NetworkBookingsSortKey[] = [
  "start",
  "userName",
  "stationName",
  "slot",
  "status",
];

/** Query для GET /api/admin/network/bookings (пагінація, q, sort, order). */
export function parseNetworkBookingsQuery(query: Record<string, unknown>): ParsedNetworkBookingsQuery {
  const rawPage = Number(query["page"]);
  const rawSize = Number(query["pageSize"]);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  let pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.floor(rawSize)
      : ADMIN_NETWORK_BOOKINGS_DEFAULT_PAGE_SIZE;
  pageSize = Math.min(ADMIN_NETWORK_BOOKINGS_MAX_PAGE_SIZE, Math.max(1, pageSize));
  const skip = (page - 1) * pageSize;

  const rawQ = query["q"];
  const search =
    typeof rawQ === "string" && rawQ.trim() !== "" ? rawQ.trim() : undefined;

  const rawSort = typeof query["sort"] === "string" ? query["sort"] : "start";
  const sort = NETWORK_BOOKINGS_SORT_KEYS.includes(rawSort as NetworkBookingsSortKey)
    ? (rawSort as NetworkBookingsSortKey)
    : "start";

  const rawOrder = typeof query["order"] === "string" ? query["order"].toLowerCase() : "desc";
  const order: "asc" | "desc" = rawOrder === "asc" ? "asc" : "desc";

  const rawStatus = query["status"];
  const status =
    typeof rawStatus === "string" &&
    NETWORK_BOOKING_UI_FILTERS.includes(rawStatus as NetworkBookingUiFilter)
      ? (rawStatus as NetworkBookingUiFilter)
      : undefined;

  const period = parseNetworkListPeriod(query["period"]);

  const parsed: ParsedNetworkBookingsQuery = {
    page,
    pageSize,
    skip,
    sort,
    order,
    period,
    ...(search !== undefined ? { search } : {}),
    ...(status !== undefined ? { status } : {}),
  };
  return parsed;
}

/** Список сесій у глобальній адмінці. */
export const ADMIN_NETWORK_SESSIONS_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_NETWORK_SESSIONS_MAX_PAGE_SIZE = 5000;

export type NetworkSessionsSortKey =
  | "startedAt"
  | "userName"
  | "stationName"
  | "portLabel"
  | "kwh"
  | "status"
  | "cost";

/** Фільтр списку сесій (як у UI). */
export type NetworkSessionUiFilter = "active" | "completed" | "failed";

const NETWORK_SESSION_UI_FILTERS: readonly NetworkSessionUiFilter[] = [
  "active",
  "completed",
  "failed",
];

export type ParsedNetworkSessionsQuery = {
  page: number;
  pageSize: number;
  skip: number;
  search?: string;
  status?: NetworkSessionUiFilter;
  sort: NetworkSessionsSortKey;
  order: "asc" | "desc";
  period: NetworkListPeriod;
};

const NETWORK_SESSIONS_SORT_KEYS: readonly NetworkSessionsSortKey[] = [
  "startedAt",
  "userName",
  "stationName",
  "portLabel",
  "kwh",
  "status",
  "cost",
];

/** Query для GET /api/admin/network/sessions (пагінація, q, sort, order). */
export function parseNetworkSessionsQuery(query: Record<string, unknown>): ParsedNetworkSessionsQuery {
  const rawPage = Number(query["page"]);
  const rawSize = Number(query["pageSize"]);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  let pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.floor(rawSize)
      : ADMIN_NETWORK_SESSIONS_DEFAULT_PAGE_SIZE;
  pageSize = Math.min(ADMIN_NETWORK_SESSIONS_MAX_PAGE_SIZE, Math.max(1, pageSize));
  const skip = (page - 1) * pageSize;

  const rawQ = query["q"];
  const search =
    typeof rawQ === "string" && rawQ.trim() !== "" ? rawQ.trim() : undefined;

  const rawSort = typeof query["sort"] === "string" ? query["sort"] : "startedAt";
  const sort = NETWORK_SESSIONS_SORT_KEYS.includes(rawSort as NetworkSessionsSortKey)
    ? (rawSort as NetworkSessionsSortKey)
    : "startedAt";

  const rawOrder = typeof query["order"] === "string" ? query["order"].toLowerCase() : "desc";
  const order: "asc" | "desc" = rawOrder === "asc" ? "asc" : "desc";

  const rawStatus = query["status"];
  const status =
    typeof rawStatus === "string" &&
    NETWORK_SESSION_UI_FILTERS.includes(rawStatus as NetworkSessionUiFilter)
      ? (rawStatus as NetworkSessionUiFilter)
      : undefined;

  const period = parseNetworkListPeriod(query["period"]);

  const parsed: ParsedNetworkSessionsQuery = {
    page,
    pageSize,
    skip,
    sort,
    order,
    period,
    ...(search !== undefined ? { search } : {}),
    ...(status !== undefined ? { status } : {}),
  };
  return parsed;
}

export const ADMIN_NETWORK_PAYMENTS_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_NETWORK_PAYMENTS_MAX_PAGE_SIZE = 2000;

export type NetworkPaymentsSortKey =
  | "createdAt"
  | "userName"
  | "sessionId"
  | "method"
  | "amount"
  | "status";

/** Фільтр списку платежів (bill), як у UI. */
export type NetworkPaymentUiFilter = "success" | "pending" | "failed";

const NETWORK_PAYMENT_UI_FILTERS: readonly NetworkPaymentUiFilter[] = [
  "success",
  "pending",
  "failed",
];

const NETWORK_PAYMENTS_SORT_KEYS: readonly NetworkPaymentsSortKey[] = [
  "createdAt",
  "userName",
  "sessionId",
  "method",
  "amount",
  "status",
];

export type ParsedNetworkPaymentsQuery = {
  page: number;
  pageSize: number;
  skip: number;
  search?: string;
  status?: NetworkPaymentUiFilter;
  sort: NetworkPaymentsSortKey;
  order: "asc" | "desc";
  period: NetworkListPeriod;
};

/** Query для GET /api/admin/network/payments (пагінація, q, period, sort, order). */
export function parseNetworkPaymentsQuery(query: Record<string, unknown>): ParsedNetworkPaymentsQuery {
  const rawPage = Number(query["page"]);
  const rawSize = Number(query["pageSize"]);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  let pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.floor(rawSize)
      : ADMIN_NETWORK_PAYMENTS_DEFAULT_PAGE_SIZE;
  pageSize = Math.min(ADMIN_NETWORK_PAYMENTS_MAX_PAGE_SIZE, Math.max(1, pageSize));
  const skip = (page - 1) * pageSize;

  const rawQ = query["q"];
  const search =
    typeof rawQ === "string" && rawQ.trim() !== "" ? rawQ.trim() : undefined;

  const rawSort = typeof query["sort"] === "string" ? query["sort"] : "createdAt";
  const sort = NETWORK_PAYMENTS_SORT_KEYS.includes(rawSort as NetworkPaymentsSortKey)
    ? (rawSort as NetworkPaymentsSortKey)
    : "createdAt";

  const rawOrder = typeof query["order"] === "string" ? query["order"].toLowerCase() : "desc";
  const order: "asc" | "desc" = rawOrder === "asc" ? "asc" : "desc";

  const rawStatus = query["status"];
  const status =
    typeof rawStatus === "string" &&
    NETWORK_PAYMENT_UI_FILTERS.includes(rawStatus as NetworkPaymentUiFilter)
      ? (rawStatus as NetworkPaymentUiFilter)
      : undefined;

  const period = parseNetworkListPeriod(query["period"]);

  const parsed: ParsedNetworkPaymentsQuery = {
    page,
    pageSize,
    skip,
    sort,
    order,
    period,
    ...(search !== undefined ? { search } : {}),
    ...(status !== undefined ? { status } : {}),
  };
  return parsed;
}

/** Сортування списку користувачів (адмінка) — застосовується в БД до пагінації. */
export type AdminUsersSortKey = "name" | "email" | "phone" | "role";

const ADMIN_USERS_SORT_KEYS: readonly AdminUsersSortKey[] = ["name", "email", "phone", "role"];

export function parseAdminUsersSortQuery(query: Record<string, unknown>): {
  sort: AdminUsersSortKey;
  order: "asc" | "desc";
} {
  const rawSort = typeof query["sort"] === "string" ? query["sort"] : "name";
  const sort = ADMIN_USERS_SORT_KEYS.includes(rawSort as AdminUsersSortKey)
    ? (rawSort as AdminUsersSortKey)
    : "name";
  const rawOrder = typeof query["order"] === "string" ? query["order"].toLowerCase() : "asc";
  const order: "asc" | "desc" = rawOrder === "desc" ? "desc" : "asc";
  return { sort, order };
}
