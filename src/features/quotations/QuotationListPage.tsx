import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr } from "@/components/ui/chrome";
import { Input } from "@/components/ui/input";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { QUOTATION_PATHS } from "@shared/api";

import { effectiveStatusOf, formatUsd, useCan } from "./quotation-model";
import type { QuotationRow } from "./quotation-model";

export function QuotationsListPage() {
  const { tx } = useCopy();
  const canCreate = useCan("quotations.create");
  const canExport = useCan("quotations.export");
  const [query, setQuery] = useState("");
  const list = useQuery({
    queryKey: ["quotations", query],
    queryFn: async () =>
      (await api<{ rows: QuotationRow[]; total: number }>(`${QUOTATION_PATHS.list}?q=${encodeURIComponent(query)}`)).data,
  });

  return (
    <div className="space-y-4" data-testid="quotations-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tx("quotations", "Quotations")}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">{tx("quotationsHint", "Independent commercial quotations and proforma documents.")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/proformas">{tx("proformas", "Proforma invoices")}</Link></Button>
          {canExport ? (
            <Button asChild variant="outline" size="sm">
              <a href="/api/v1/quotations.csv">{tx("quotationDownloadCsv", "Download CSV")}</a>
            </Button>
          ) : null}
          {canCreate ? (
            <Button asChild size="sm">
              <Link to="/quotations/new">
                <Plus className="h-4 w-4" />
                {tx("quotationNew", "New quotation")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(new FormData(event.currentTarget).get("q")?.toString().trim() ?? "");
        }}
      >
        <Input name="q" aria-label={tx("search", "Search")} placeholder={tx("quotationSearch", "Search by number, title or customer")} className="max-w-md" />
      </form>
      {list.isLoading ? <ResponsiveListSkeleton rows={5} columns={6} label={tx("loading", "Loading…")} /> : null}
      {list.isError ? <p className="text-sm text-danger">{tx("errorState", "Could not load the list.")}</p> : null}
      {!list.isLoading && !list.isError && list.data && list.data.rows.length === 0 ? (
        <EmptyState>{tx("quotationEmpty", "No quotations yet.")}</EmptyState>
      ) : null}
      {list.data && list.data.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <th className="p-3 text-start">{tx("quotationNumber", "Quote no.")}</th>
                <th className="p-3 text-start">{tx("quotationTitle", "Title")}</th>
                <th className="p-3 text-start">{tx("quotationCustomer", "Customer")}</th>
                <th className="p-3 text-start">{tx("quotationStatus", "Status")}</th>
                <th className="p-3 text-start">{tx("quotationValidUntil", "Valid until")}</th>
                <th className="p-3 text-start">{tx("quotationSubtotal", "Subtotal")}</th>
                <th className="p-3 text-start">{tx("quotationCaseRef", "Case ref")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.rows.map((row) => (
                <tr key={row.id} className="border-b border-line/60 last:border-0 hover:bg-paper/60">
                  <td className="p-3 font-semibold">
                    <Link to={`/quotations/${row.id}`} className="text-accent hover:underline">
                      <Ltr>{row.quote_number_display}</Ltr>
                    </Link>
                  </td>
                  <td className="p-3">{row.title ?? "—"}</td>
                  <td className="p-3">{row.customer_name ?? "—"}</td>
                  <td className="p-3">
                    <StatusBadge value={effectiveStatusOf(row)} />
                  </td>
                  <td className="p-3">{row.valid_until ? <Ltr>{row.valid_until.slice(0, 10)}</Ltr> : "—"}</td>
                  <td className="p-3">
                    <Ltr>{formatUsd(row.subtotal_minor)}</Ltr>
                  </td>
                  <td className="p-3">{row.case_reference ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
