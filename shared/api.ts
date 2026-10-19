export type ApiSuccess<T> = {
  data: T;
  meta: {
    requestId: string;
    page?: number;
    pageSize?: number;
    total?: number;
  };
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

export type PageQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function normalizePage(page = 1, pageSize = DEFAULT_PAGE_SIZE): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeSize = Math.min(
    MAX_PAGE_SIZE,
    Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE,
  );
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

export const PUBLIC_TRACKING_FIELDS = [
  "caseReference",
  "invoiceNumber",
  "exporterDisplayName",
  "destinationCountry",
  "portOfLoading",
  "portOfDischarge",
  "documentRoute",
  "documentTrackStatus",
  "goodsTrackStatus",
  "courierCarrier",
  "courierTrackingNumber",
  "courierStatus",
  "bookingNumber",
  "plannedEtd",
  "actualEtd",
  "plannedEta",
  "actualEta",
  "containers",
  "lastUpdatedAt",
] as const;
