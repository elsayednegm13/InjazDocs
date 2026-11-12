import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr } from "@/components/ui/chrome";
import { ListToolbar, PaginationFooter, useListController } from "@/components/ui/list-toolbar";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { QUOTATION_PATHS, QUOTATION_STATUSES } from "@shared/api";

import { effectiveStatusOf, formatUsd, useCan } from "./quotation-model";
import type { QuotationRow } from "./quotation-model";

export function QuotationsListPage() {
  const { tx } = useCopy();
  const canCreate = useCan("quotations.create");
  const canExport = useCan("quotations.export");

  const listQuery = useQuery({
    queryKey: ["quotations"],
    queryFn: async () =>
      (await api<{ rows: QuotationRow[]; total: number }>(`${QUOTATION_PATHS.list}?pageSize=500`)).data,
    placeholderData: keepPreviousData,
  });

  const rawRows = listQuery.data?.rows ?? [];

  const list = useListController(rawRows, {
    storageKey: "quotations",
    searchText: (row) =>
      [row.quote_number, row.quote_number_display, row.title, row.customer_name, row.case_reference]
        .filter(Boolean)
        .join(" "),
    statusOf: (row) => effectiveStatusOf(row),
    dateOf: (row) => row.issued_at || row.created_at,
    idOf: (row) => row.id,
  });

  const statusOptions = QUOTATION_STATUSES.map((st) => ({
    value: st,
    label: tx(`status.${st}`, st),
  }));

  const exportColumns = [
    { header: tx("quotationNumber", "Quote no."), value: (r: QuotationRow) => r.quote_number_display },
    { header: tx("quotationTitle", "Title"), value: (r: QuotationRow) => r.title || "—" },
    { header: tx("quotationCustomer", "Customer"), value: (r: QuotationRow) => r.customer_name || "—" },
    { header: tx("quotationStatus", "Status"), value: (r: QuotationRow) => tx(`status.${effectiveStatusOf(r)}`, effectiveStatusOf(r)) },
    { header: tx("quotationValidUntil", "Valid until"), value: (r: QuotationRow) => (r.valid_until ? r.valid_until.slice(0, 10) : "—") },
    { header: tx("quotationSubtotal", "Subtotal"), value: (r: QuotationRow) => formatUsd(r.subtotal_minor) },
    { header: tx("quotationCaseRef", "Case ref"), value: (r: QuotationRow) => r.case_reference || "—" },
    { header: tx("updated", "Created"), value: (r: QuotationRow) => (r.issued_at || r.created_at || "").slice(0, 10) },
  ];

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

      <ListToolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={tx("quotationSearch", "Search by number, title or customer")}
        searchAriaLabel={tx("search", "Search")}
        status={list.status}
        onStatusChange={list.setStatus}
        statusOptions={statusOptions}
        year={list.year}
        onYearChange={list.setYear}
        availableYears={list.availableYears}
        month={list.month}
        onMonthChange={list.setMonth}
        sortOrder={list.sortOrder}
        onSortOrderChange={list.setSortOrder}
        activeFilterCount={list.activeFilterCount}
        onResetFilters={list.resetFilters}
        totalFiltered={list.totalFiltered}
        exportConfig={{
          filename: "exportflow-quotations",
          sheetName: tx("quotations", "Quotations"),
          columns: exportColumns,
          rows: list.filteredRows,
        }}
      />

      {listQuery.isLoading ? <ResponsiveListSkeleton rows={5} columns={6} label={tx("loading", "Loading…")} /> : null}
      {listQuery.isError ? <p className="text-sm text-danger">{tx("errorState", "Could not load the list.")}</p> : null}
      {!listQuery.isLoading && !listQuery.isError && list.pagedRows.length === 0 ? (
        <EmptyState>{tx("quotationEmpty", "No quotations yet.")}</EmptyState>
      ) : null}
      {list.pagedRows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-card shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper text-xs uppercase tracking-wide text-ink-muted">
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
              {list.pagedRows.map((row) => (
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

      <PaginationFooter
        page={list.page}
        totalPages={list.totalPages}
        totalItems={list.totalFiltered}
        startIndex={list.startIndex}
        endIndex={list.endIndex}
        onPageChange={list.setPage}
      />
    </div>
  );
}
