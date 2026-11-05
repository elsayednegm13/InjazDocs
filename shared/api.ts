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

/* ---------------------------------------------------------------------------
 * W2 independent quotations (owner-approved, D-10). The quotation is a separate
 * commercial document with its own manual number and lifecycle. Status is the
 * stored lifecycle value; expiry is effective (no cron).
 * ------------------------------------------------------------------------- */

export const QUOTATION_STATUSES = ["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "EXPIRED"] as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** Client paths. The CSV/PDF hrefs also live here for download links. */
export const QUOTATION_PATHS = {
  list: "/api/v1/quotations",
  csvHref: "/api/v1/quotations.csv",
  detail: (id: string) => `/api/v1/quotations/${id}`,
  revisions: (id: string) => `/api/v1/quotations/${id}/revisions`,
  pdf: (id: string, revision?: number) =>
    `/api/v1/quotations/${id}/pdf${revision ? `?revision=${revision}` : ""}`,
  items: (id: string) => `/api/v1/quotations/${id}/items`,
  item: (id: string, itemId: string) => `/api/v1/quotations/${id}/items/${itemId}`,
  issue: (id: string) => `/api/v1/quotations/${id}/issue`,
  revise: (id: string) => `/api/v1/quotations/${id}/revise`,
  response: (id: string) => `/api/v1/quotations/${id}/response`,
  link: (id: string) => `/api/v1/quotations/${id}/link`,
  unlink: (id: string) => `/api/v1/quotations/${id}/unlink`,
  copyItems: (id: string) => `/api/v1/quotations/${id}/copy-items`,
  archive: (id: string) => `/api/v1/quotations/${id}/archive`,
} as const;
