import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { DataCard, DataCards, DataCell, DataFrame, DataHead, DataHeadCell, DataRow } from "@/components/ui/data-view";
import { ListToolbar, PaginationFooter, useListController } from "@/components/ui/list-toolbar";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";

export function CustomersListPage() {
  const { tx, i18n } = useCopy();
  const query = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/customers?pageSize=500")).data,
    placeholderData: keepPreviousData,
  });

  const allRows = query.data ?? [];

  const list = useListController(allRows, {
    storageKey: "customers",
    searchText: (row) =>
      [row.legal_name, row.trade_name, row.customer_code, row.country_code].filter(Boolean).join(" "),
    statusOf: (row) => row.country_code ?? "",
    dateOf: (row) => row.created_at || row.updated_at,
    idOf: (row) => row.id,
  });

  const countryOptions = Array.from(
    new Set(allRows.map((r) => r.country_code).filter(Boolean)),
  )
    .sort()
    .map((code) => ({ value: code, label: code }));

  const exportColumns = [
    { header: tx("customerCode", "Code"), value: (r: Record<string, string>) => r.customer_code || "—" },
    { header: tx("legalName", "Legal name"), value: (r: Record<string, string>) => r.legal_name },
    { header: tx("tradeName", "Trade name"), value: (r: Record<string, string>) => r.trade_name || "—" },
    { header: tx("country", "Country"), value: (r: Record<string, string>) => r.country_code || "—" },
    { header: tx("updated", "Updated"), value: (r: Record<string, string>) => (r.updated_at || r.created_at || "").slice(0, 10) },
  ];

  return (
    <div className="space-y-4" data-customers={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("customers", "Customers")}
        subtitle={tx("customersHint", "Every customer keeps its contacts, addresses and export history in one place.")}
        actions={<Button asChild><Link to="/customers/new">{tx("newCustomer", "New customer")}</Link></Button>}
      />

      <ListToolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={tx("searchCustomer", "Search by legal or trade name")}
        searchAriaLabel={tx("searchCustomer", "Search by legal or trade name")}
        status={list.status}
        onStatusChange={list.setStatus}
        statusOptions={countryOptions}
        allStatusesLabel={tx("allCountries", i18n.language.startsWith("ar") ? "كل الدول" : "All countries")}
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
          filename: "exportflow-customers",
          sheetName: tx("customers", "Customers"),
          columns: exportColumns,
          rows: list.filteredRows,
        }}
      />

      {query.isLoading ? <ResponsiveListSkeleton rows={5} columns={4} /> : null}
      {query.isError ? <p className="text-danger">{tx("customersError", "Could not load customers.")}</p> : null}
      {!query.isLoading && !query.isError && !list.pagedRows.length ? (
        <EmptyState>{list.activeFilterCount > 0 ? tx("noCustomersMatch", "No customers match this search.") : tx("noCustomers", "No customers yet. Create one to start an export case.")}</EmptyState>
      ) : null}
      {list.pagedRows.length ? (
        <DataFrame label={tx("customers", "Customers")} className="min-w-[760px]">
          <DataHead>
            <DataHeadCell>{tx("legalName", "Legal name")}</DataHeadCell>
            <DataHeadCell>{tx("country", "Country")}</DataHeadCell>
            <DataHeadCell>{tx("updated", "Updated")}</DataHeadCell>
            <DataHeadCell align="end">{tx("actionCol", "Action")}</DataHeadCell>
          </DataHead>
          <tbody>
            {list.pagedRows.map((row) => (
              <DataRow key={row.id}>
                <DataCell>
                  <Link className="flex items-center gap-3" to={`/customers/${row.id}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-accent/10 text-accent">
                      <Building2 className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{row.customer_code ? <Ltr className="me-1.5 text-accent">{row.customer_code}</Ltr> : null}{row.legal_name}</span>
                      {row.trade_name ? <span className="block truncate text-xs text-ink-muted">{row.trade_name}</span> : null}
                    </span>
                  </Link>
                </DataCell>
                <DataCell><Ltr className="text-ink-muted">{row.country_code || "—"}</Ltr></DataCell>
                <DataCell className="whitespace-nowrap text-xs text-ink-muted"><Ltr>{formatWhen(row.updated_at, i18n.language)}</Ltr></DataCell>
                <DataCell align="end">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/customers/${row.id}`}>{tx("openRecord", "Open")}</Link>
                  </Button>
                </DataCell>
              </DataRow>
            ))}
          </tbody>
        </DataFrame>
      ) : null}
      {list.pagedRows.length ? (
        <DataCards>
          {list.pagedRows.map((row) => (
            <DataCard
              key={row.id}
              href={`/customers/${row.id}`}
              title={<span className="inline-flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent/10 text-accent"><Building2 className="h-4 w-4" aria-hidden /></span><span className="min-w-0 truncate">{row.customer_code ? <Ltr className="me-1.5 text-accent">{row.customer_code}</Ltr> : null}{row.legal_name}</span></span>}
              meta={row.trade_name || undefined}
            >
              <div className="flex items-center justify-between text-xs text-ink-muted">
                <Ltr>{row.country_code || "—"}</Ltr>
                <Ltr>{formatWhen(row.updated_at, i18n.language)}</Ltr>
              </div>
            </DataCard>
          ))}
        </DataCards>
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
