import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession, can } from "@/app/access";
import { api } from "@/lib/api";
import { type QuotationStatus } from "@shared/api";

export type QuotationRow = {
  id: string;
  quote_number: string;
  quote_number_display: string;
  title: string | null;
  customer_id: string;
  customer_name: string | null;
  status: QuotationStatus;
  validity_days: number;
  issued_at: string | null;
  valid_until: string | null;
  client_response: string | null;
  case_id: string | null;
  case_reference: string | null;
  archived_at: string | null;
  archived_reason: string | null;
  subtotal_minor: number;
  active_revision: number;
  /** Present on the detail endpoint (full row); absent on list rows. */
  version?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  incoterm?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
};

export type QuotationItemRow = {
  id: string;
  quotation_id: string;
  revision: number;
  position: number;
  description: string;
  quantity_text: string;
  quantity_minor: number;
  unit_label: string | null;
  unit_price_text: string;
  unit_price_minor_4: number;
  line_total_minor: number;
};

export type QuotationDetailQuote = QuotationRow & { version: number };

export type QuotationDetail = {
  quote: QuotationDetailQuote;
  customer: { id: string; legal_name: string; trade_name: string | null };
  items: QuotationItemRow[];
  revisions: {
    id: string;
    revision: number;
    reason: string;
    actor_id: string | null;
    issued_at: string;
    valid_until: string;
    company_name: string;
    customer_name: string;
    customer_address: string | null;
    case_reference: string | null;
    currency: string;
    subtotal_minor: number;
    created_at: string;
  }[];
  effectiveStatus: QuotationStatus;
};

export type CustomerOption = { id: string; legal_name: string; trade_name: string | null };
export type CaseOption = { id: string; case_reference: string; customer_id: string };

export type ItemDraft = { description: string; quantity: string; unitLabel: string; unitPrice: string };

/* ---------------------------------------------------------------- helpers -- */

/**
 * Display-only money formatting from integer cents. Money decisions are made
 * server-side with bigint; this value never feeds arithmetic.
 */
export function formatUsd(minor: number): string {
  const value = Number(minor);
  const body = `${Math.floor(Math.abs(value) / 100).toLocaleString("en-US")}.${String(Math.abs(value) % 100).padStart(2, "0")}`;
  return value < 0 ? `-USD ${body}` : `USD ${body}`;
}

/** Mirrors the server's effective expiry rule (no cron on either side). */
export function effectiveStatusOf(row: { status: string; valid_until: string | null }): QuotationStatus {
  if (row.status === "ISSUED" && row.valid_until && new Date(row.valid_until) < new Date()) return "EXPIRED";
  return row.status as QuotationStatus;
}

export function useCan(perm: string): boolean {
  const user = useSession();
  return useMemo(() => can(user, perm), [user, perm]);
}

export function useCatalog<T>(path: string) {
  return useQuery({
    queryKey: [path],
    queryFn: async () => (await api<T[]>(path)).data,
    staleTime: 30_000,
  });
}
