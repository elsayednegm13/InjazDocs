import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { caseVisibilitySql } from "./actor";
import { hasPermission } from "../../shared/permissions";

export const SEARCH_LIMIT_PER_GROUP = 5;
export const SEARCH_MIN_LENGTH = 2;

export type SearchHit = {
  kind: "case" | "proforma" | "booking" | "container" | "customer";
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  href: string;
};

export type SearchResult = {
  q: string;
  cases: SearchHit[];
  proformas: SearchHit[];
  bookings: SearchHit[];
  containers: SearchHit[];
  customers: SearchHit[];
};

function escapeLike(term: string) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function can(actor: Actor, key: Parameters<typeof hasPermission>[1]) {
  return hasPermission(actor.permissions, key);
}

/**
 * Global spotlight search. One D1 batch, at most five rows per group, and
 * every group is gated by the actor's own permission and case scope:
 * - cases, bookings, containers follow caseVisibilitySql (unlinked bookings
 *   and containers stay visible to holders of bookings.view / containers.view,
 *   exactly like their list endpoints);
 * - a proforma linked to a case follows that case's scope;
 * - customers require customers.view.
 * A group the actor cannot read is never queried.
 */
export async function globalSearch(db: D1Database, actor: Actor, rawQuery: string | undefined): Promise<SearchResult> {
  const q = (rawQuery ?? "").trim().slice(0, 80);
  const empty: SearchResult = { q, cases: [], proformas: [], bookings: [], containers: [], customers: [] };
  if (q.length < SEARCH_MIN_LENGTH) return empty;
  if (!actor) throw errors.forbidden();
  const like = `%${escapeLike(q)}%`;
  const limit = SEARCH_LIMIT_PER_GROUP;

  type Group = keyof Omit<SearchResult, "q">;
  const plan: Array<{ group: Group; statement: D1PreparedStatement }> = [];

  if (can(actor, "export_cases.view_all") || can(actor, "export_cases.view_assigned")) {
    const vis = caseVisibilitySql(actor, "c");
    plan.push({
      group: "cases",
      statement: db
        .prepare(
          `SELECT c.id, c.case_reference AS title, cu.legal_name AS subtitle, c.status
           FROM export_cases c
           JOIN customers cu ON cu.id = c.customer_id
           WHERE (${vis.sql})
             AND (c.case_reference LIKE ? ESCAPE '\\' OR cu.legal_name LIKE ? ESCAPE '\\' OR cu.customer_code LIKE ? ESCAPE '\\'
                  OR EXISTS (SELECT 1 FROM export_invoices i WHERE i.case_id = c.id AND i.invoice_number LIKE ? ESCAPE '\\'))
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT ?`,
        )
        .bind(...vis.binds, like, like, like, like, limit),
    });
  }

  if (can(actor, "proformas.view")) {
    const vis = caseVisibilitySql(actor, "c");
    plan.push({
      group: "proformas",
      statement: db
        .prepare(
          `SELECT p.id, p.invoice_number AS title, cu.legal_name AS subtitle, p.status
           FROM proforma_invoices p
           JOIN customers cu ON cu.id = p.customer_id
           LEFT JOIN export_cases c ON c.id = p.case_id
           WHERE (p.case_id IS NULL OR (${vis.sql}))
             AND (p.invoice_number LIKE ? ESCAPE '\\' OR p.print_reference LIKE ? ESCAPE '\\' OR cu.legal_name LIKE ? ESCAPE '\\')
           ORDER BY COALESCE(p.created_at, p.invoice_date) DESC, p.id DESC
           LIMIT ?`,
        )
        .bind(...vis.binds, like, like, like, limit),
    });
  }

  if (can(actor, "bookings.view")) {
    const vis = caseVisibilitySql(actor, "c");
    plan.push({
      group: "bookings",
      statement: db
        .prepare(
          `SELECT b.id, b.booking_number AS title, COALESCE(c.case_reference, b.shipping_line) AS subtitle, b.status
           FROM bookings b
           LEFT JOIN export_cases c ON c.id = b.case_id
           WHERE (b.case_id IS NULL OR (${vis.sql}))
             AND (b.booking_number LIKE ? ESCAPE '\\' OR b.ucr LIKE ? ESCAPE '\\' OR c.case_reference LIKE ? ESCAPE '\\')
           ORDER BY b.created_at DESC, b.id DESC
           LIMIT ?`,
        )
        .bind(...vis.binds, like, like, like, limit),
    });
  }

  if (can(actor, "containers.view")) {
    const vis = caseVisibilitySql(actor, "c");
    plan.push({
      group: "containers",
      statement: db
        .prepare(
          `SELECT k.id, k.official_number AS title, b.booking_number AS subtitle, k.status, k.booking_id
           FROM containers k
           LEFT JOIN bookings b ON b.id = k.booking_id
           LEFT JOIN export_cases c ON c.id = k.case_id
           WHERE (k.case_id IS NULL OR (${vis.sql}))
             AND k.official_number IS NOT NULL AND k.official_number LIKE ? ESCAPE '\\'
           ORDER BY k.created_at DESC, k.id DESC
           LIMIT ?`,
        )
        .bind(...vis.binds, like, limit),
    });
  }

  if (can(actor, "customers.view")) {
    plan.push({
      group: "customers",
      statement: db
        .prepare(
          `SELECT id, legal_name AS title, customer_code AS subtitle, country_code AS status
           FROM customers
           WHERE legal_name LIKE ? ESCAPE '\\' OR trade_name LIKE ? ESCAPE '\\' OR customer_code LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .bind(like, like, like, limit),
    });
  }

  if (plan.length === 0) return empty;
  const results = await db.batch(plan.map((p) => p.statement));
  const out = { ...empty };
  plan.forEach((entry, index) => {
    const rows = (results[index]?.results ?? []) as Array<Record<string, string | null>>;
    out[entry.group] = rows.map((row) => toHit(entry.group, row));
  });
  return out;
}

function toHit(group: keyof Omit<SearchResult, "q">, row: Record<string, string | null>): SearchHit {
  const id = String(row.id);
  const base = { id, title: String(row.title ?? ""), subtitle: row.subtitle ?? null, status: row.status ?? null };
  switch (group) {
    case "cases":
      return { ...base, kind: "case", href: `/export-cases/${id}` };
    case "proformas":
      return { ...base, kind: "proforma", href: `/proformas/${id}` };
    case "bookings":
      return { ...base, kind: "booking", href: `/bookings/${id}` };
    case "containers":
      return { ...base, kind: "container", href: row.booking_id ? `/bookings/${row.booking_id}` : `/containers?q=${encodeURIComponent(base.title)}` };
    case "customers":
      return { ...base, kind: "customer", href: `/customers/${id}` };
  }
}

