import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Building2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { DataCard, DataCards, DataCell, DataFrame, DataHead, DataHeadCell, DataRow } from "@/components/ui/data-view";
import { Input } from "@/components/ui/input";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";

export function CustomersListPage() {
  const { tx, i18n } = useCopy();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ["customers", q],
    queryFn: async () => (await api<Array<Record<string, string>>>(`/api/v1/customers?pageSize=100&q=${encodeURIComponent(q)}`)).data,
    placeholderData: keepPreviousData,
  });
  const rows = query.data ?? [];
  return (
    <div className="space-y-4" data-customers={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("customers", "Customers")}
        subtitle={tx("customersHint", "Every customer keeps its contacts, addresses and export history in one place.")}
        actions={<Button asChild><Link to="/customers/new">{tx("newCustomer", "New customer")}</Link></Button>}
      />
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-card p-4 shadow-card">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-ink-muted" aria-hidden />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tx("searchCustomer", "Search by legal or trade name")}
            aria-label={tx("searchCustomer", "Search by legal or trade name")}
            className="border-line bg-paper ps-9"
          />
        </div>
        <span className="rounded-full bg-paper px-3 py-1 text-xs font-semibold tabular-nums text-ink-muted">
          {tx("results", "Results")}: <Ltr>{rows.length}</Ltr>
        </span>
      </div>
      {query.isLoading ? <ResponsiveListSkeleton rows={5} columns={4} /> : null}
      {query.isError ? <p className="text-danger">{tx("customersError", "Could not load customers.")}</p> : null}
      {!query.isLoading && !query.isError && !rows.length ? (
        <EmptyState>{q ? tx("noCustomersMatch", "No customers match this search.") : tx("noCustomers", "No customers yet. Create one to start an export case.")}</EmptyState>
      ) : null}
      {rows.length ? (
        <DataFrame label={tx("customers", "Customers")} className="min-w-[760px]">
          <DataHead>
            <DataHeadCell>{tx("legalName", "Legal name")}</DataHeadCell>
            <DataHeadCell>{tx("country", "Country")}</DataHeadCell>
            <DataHeadCell>{tx("updated", "Updated")}</DataHeadCell>
            <DataHeadCell align="end">{tx("actionCol", "Action")}</DataHeadCell>
          </DataHead>
          <tbody>
            {rows.map((row) => (
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
      {rows.length ? (
        <DataCards>
          {rows.map((row) => (
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
    </div>
  );
}
