import { Boxes, CheckCircle2, FileStack, MousePointerClick, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader, StatCard } from "@/components/ui/chrome";
import { DataCard, DataCards, DataCell, DataFrame, DataHead, DataHeadCell, DataRow } from "@/components/ui/data-view";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { can, useSession } from "@/app/access";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";

export function CasesListPage() {
  const { tx, stored } = useCopy();
  const user = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = params.get("q") ?? "";
  const query = useQuery({
    queryKey: ["cases", q],
    queryFn: async () =>
      (await api<Array<Record<string, string>>>(q ? `/api/v1/export-cases?pageSize=100&q=${encodeURIComponent(q)}` : "/api/v1/export-cases")).data,
  });
  const counts = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api<{ counts: Record<string, number> }>("/api/v1/dashboard")).data,
  });
  const selected = query.data?.find((row) => row.id === selectedId) ?? null;
  return (
    <div className="space-y-4" data-cases={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("exportOperations", "Export operations")}
        subtitle={tx("casesHint", "Search uses the existing server filter. Cargo completion is not a list column.")}
        actions={can(user, "export_cases.create") ? <Button asChild><Link to="/export-cases/new">{tx("newCase", "New export case")}</Link></Button> : null}
      />
      {counts.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={tx("openCases", "Open cases")} value={counts.data.counts.total_cases} icon={<Boxes className="h-5 w-5" />} tone="blue" />
          <StatCard label={tx("completedCases", "Completed cases")} value={counts.data.counts.completed} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
          <StatCard label={tx("docsPending", "Documents pending")} value={counts.data.counts.docs_pending} icon={<FileStack className="h-5 w-5" />} tone="amber" />
          <StatCard label={tx("courierOpen", "Courier in transit")} value={counts.data.counts.courier_open} icon={<Package className="h-5 w-5" />} tone="teal" />
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-card p-4 shadow-card"
        onSubmit={(event) => {
          event.preventDefault();
          const next = String(new FormData(event.currentTarget).get("q") ?? "").trim();
          navigate(next ? `/export-cases?q=${encodeURIComponent(next)}` : "/export-cases");
        }}
      >
        <Input key={q} name="q" defaultValue={q} aria-label={tx("search", "Search by case, invoice, booking, container, or customer")} placeholder={tx("search", "Search by case, invoice, booking, container, or customer")} className="max-w-md border-line bg-paper" />
        <Button type="submit" variant="outline">{tx("searchAction", "Search")}</Button>
      </form>
      {query.isLoading ? <ResponsiveListSkeleton rows={5} columns={5} /> : null}
      {query.isError ? <p className="text-danger">{tx("casesError", "Could not load cases.")}</p> : null}
      {!query.isLoading && !query.isError && !query.data?.length ? <EmptyState>{tx("noCases", "No export cases match this filter.")}</EmptyState> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <DataCards>
          {query.data?.map((row) => (
            <DataCard
              key={row.id}
              href={`/export-cases/${row.id}`}
              title={<Ltr className="text-accent">{row.case_reference}</Ltr>}
              meta={row.customer_name}
              badge={<StatusBadge value={row.status} />}
            >
              <p className="text-sm text-ink">{tx(`status.${row.document_route}`, row.document_route)}</p>
              <p className="mt-1 text-sm text-ink-muted">{stored(row.next_action)}</p>
              <p className="text-xs text-ink-muted"><Ltr>{row.invoice_numbers || "—"}</Ltr> · <Ltr>{row.destination_country || "—"}</Ltr></p>
              <div className="mt-2"><StatusBadge value={row.document_route === "BANK_ROUTE" ? row.bank_path_status : row.direct_path_status} /></div>
            </DataCard>
          ))}
        </DataCards>
        <DataFrame label={tx("exportOperations", "Export operations")} className="min-w-[900px]">
          <DataHead>
            <DataHeadCell>{tx("case", "Case")}</DataHeadCell>
            <DataHeadCell>{tx("customer", "Customer")}</DataHeadCell>
            <DataHeadCell>{tx("invoices", "Invoices")}</DataHeadCell>
            <DataHeadCell>{tx("country", "Country")}</DataHeadCell>
            <DataHeadCell>{tx("documentRoute", "Document route")}</DataHeadCell>
            <DataHeadCell>{tx("nextAction", "Next action")}</DataHeadCell>
            <DataHeadCell>{tx("docs", "Docs")}</DataHeadCell>
            <DataHeadCell>{tx("goods", "Goods")}</DataHeadCell>
            <DataHeadCell>{tx("status", "Status")}</DataHeadCell>
          </DataHead>
          <tbody>
            {query.data?.map((row) => (
              <DataRow key={row.id} selected={selectedId === row.id} onClick={() => setSelectedId(row.id)}>
                <DataCell className="whitespace-nowrap"><Link aria-label={`${row.case_reference} ${row.customer_name}`} className="font-semibold text-accent" to={`/export-cases/${row.id}`}><Ltr>{row.case_reference}</Ltr></Link></DataCell>
                <DataCell>{row.customer_name}</DataCell>
                <DataCell><Ltr>{row.invoice_numbers || "—"}</Ltr></DataCell>
                <DataCell><Ltr>{row.destination_country || "—"}</Ltr></DataCell>
                <DataCell className="whitespace-nowrap">{tx(`status.${row.document_route}`, row.document_route)}</DataCell>
                <DataCell>{stored(row.next_action)}</DataCell>
                <DataCell><StatusBadge value={row.document_route === "BANK_ROUTE" ? row.bank_path_status : row.direct_path_status} /></DataCell>
                <DataCell className="whitespace-nowrap text-xs text-ink-muted">
                  <span className="rounded-full bg-paper px-2 py-0.5">{tx("goodsIndependentShort", "Independent")}</span>
                </DataCell>
                <DataCell><StatusBadge value={row.status} /></DataCell>
              </DataRow>
            ))}
          </tbody>
        </DataFrame>
        {selected ? (
          <aside className="hidden rounded-card border border-line bg-card p-4 shadow-card xl:block">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{tx("casePreview", "Selected case")}</p>
            <p className="mt-1 text-lg font-semibold text-ink"><Ltr>{selected.case_reference}</Ltr></p>
            <dl className="mt-3 space-y-2.5 border-t border-line pt-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{tx("customer", "Customer")}</dt>
                <dd className="min-w-0 truncate font-medium">{selected.customer_name}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{tx("documentRoute", "Document route")}</dt>
                <dd className="font-medium">{tx(`status.${selected.document_route}`, selected.document_route)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{tx("docs", "Docs")}</dt>
                <dd><StatusBadge value={selected.document_route === "BANK_ROUTE" ? selected.bank_path_status : selected.direct_path_status} /></dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{tx("status", "Status")}</dt>
                <dd><StatusBadge value={selected.status} /></dd>
              </div>
            </dl>
            <p className="mt-3 rounded-lg bg-paper/70 px-2.5 py-2 text-xs leading-snug text-ink-muted">{stored(selected.next_action)}</p>
            <Button asChild className="mt-4 w-full"><Link to={`/export-cases/${selected.id}`}>{tx("openFullCase", "Open full case")}</Link></Button>
          </aside>
        ) : (
          <aside className="hidden rounded-card border border-dashed border-line bg-card p-6 xl:grid xl:place-items-center">
            <div className="text-center text-sm text-ink-muted">
              <MousePointerClick className="mx-auto h-6 w-6 text-ink-muted/70" aria-hidden />
              <p className="mt-2">{tx("selectCase", "Select a case to preview fields already on this list.")}</p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
