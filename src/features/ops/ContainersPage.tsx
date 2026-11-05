import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Boxes, CheckCircle2, CircleDashed, Search, Ship } from "lucide-react";
import { can, useSession } from "@/app/access";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader, StatCard } from "@/components/ui/chrome";
import { DataCard, DataCards, DataCell, DataFrame, DataHead, DataHeadCell, DataRow } from "@/components/ui/data-view";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useContainerStatusMutation } from "@/lib/containers";
import { formatWhen, useCopy } from "@/lib/copy";
import { nextContainerStatuses } from "@shared/container-flow";

import { FilterChip, JourneyRail } from "./ops-parts";

const CONTAINER_FILTERS = [
  "NUMBER_ASSIGNED",
  "GATED_IN",
  "LOADED",
  "DEPARTED",
  "ARRIVED_PORT",
  "CUSTOMS_RELEASED",
  "DELIVERED_TO_CUSTOMER",
  "EXCEPTION",
  "CANCELLED",
] as const;

function ContainerActions({
  row,
  busy,
  onMove,
}: {
  row: Record<string, string>;
  busy: boolean;
  onMove: (status: string) => void;
}) {
  const { tx } = useCopy();
  const next = nextContainerStatuses(row.status);
  if (!next.length) return <span className="text-xs text-ink-muted">{tx("none", "—")}</span>;
  if (next[0] === "NUMBER_ASSIGNED") {
    return (
      <Button asChild size="sm" variant="outline">
        <Link to={`/bookings/${row.booking_id}`}>{tx("assignNumber", "Assign number")}</Link>
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={busy} onClick={() => onMove(next[0])}>
        {tx("nextStage", "Next stage")}
        <span className="ms-1 hidden text-[11px] opacity-80 2xl:inline">· {tx(`status.${next[0]}`, next[0])}</span>
      </Button>
      {next.length > 1 ? (
        <Select
          className="h-8 w-auto px-1.5 text-xs"
          value=""
          aria-label={tx("otherStage", "Other stage…")}
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) onMove(event.target.value);
          }}
        >
          <option value="">{tx("otherStage", "Other stage…")}</option>
          {next.slice(1).map((status) => (
            <option key={status} value={status}>{tx(`status.${status}`, status)}</option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

export function ContainersPage() {
  const { tx, i18n } = useCopy();
  const user = useSession();
  const manage = can(user, "containers.manage");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const move = useContainerStatusMutation();

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ["containers", q, status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      const suffix = params.toString();
      return (await api<Array<Record<string, string>>>(`/api/v1/containers${suffix ? `?${suffix}` : ""}`)).data;
    },
    placeholderData: keepPreviousData,
  });

  const rows = query.data ?? [];
  const counts = {
    total: rows.length,
    awaiting: rows.filter((row) => row.status === "PLANNED").length,
    transit: rows.filter((row) => ["GATED_IN", "LOADED", "DEPARTED"].includes(row.status)).length,
    delivered: rows.filter((row) => row.status === "DELIVERED_TO_CUSTOMER").length,
  };
  const busyId = move.isPending ? move.variables?.id : null;
  const moveContainer = (row: Record<string, string>, next: string) =>
    move.mutate({ id: row.id, status: next, version: row.version });

  return (
    <div className="space-y-4" data-containers={query.isLoading ? "loading" : "ready"}>
      <PageHeader title={tx("containers", "Containers")} subtitle={tx("containersHint", "Move a container along its journey here: the row updates instantly, no refresh.")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={tx("containers", "Containers")} value={counts.total} icon={<Boxes className="h-5 w-5" />} tone="blue" hint={tx("containerSummaryHint", "Summary of the containers listed below.")} />
        <StatCard label={tx("awaitingNumber", "Awaiting number")} value={counts.awaiting} icon={<CircleDashed className="h-5 w-5" />} tone="amber" />
        <StatCard label={tx("inTransit", "In transit")} value={counts.transit} icon={<Ship className="h-5 w-5" />} tone="teal" />
        <StatCard label={tx("deliveredToCustomer", "Delivered to customer")} value={counts.delivered} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-card p-4 shadow-card">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-ink-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tx("searchContainer", "Search by container or booking number")}
            aria-label={tx("searchContainer", "Search by container or booking number")}
            className="border-line bg-paper ps-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={!status} onClick={() => setStatus("")}>{tx("allStatuses", "All statuses")}</FilterChip>
          {CONTAINER_FILTERS.map((value) => (
            <FilterChip key={value} active={status === value} onClick={() => setStatus(status === value ? "" : value)}>
              {tx(`status.${value}`, value)}
            </FilterChip>
          ))}
        </div>
      </div>

      {query.isLoading ? <ResponsiveListSkeleton rows={5} columns={5} /> : null}
      {!query.isLoading && rows.length === 0 ? <EmptyState>{tx("noContainers", "No containers match this filter.")}</EmptyState> : null}

      {rows.length ? (
        <DataFrame label={tx("containers", "Containers")} className="min-w-[1000px]">
          <DataHead>
            <DataHeadCell>{tx("containers", "Containers")}</DataHeadCell>
            <DataHeadCell>{tx("slot", "Slot")}</DataHeadCell>
            <DataHeadCell>{tx("bookings", "Bookings")}</DataHeadCell>
            <DataHeadCell>{tx("case", "Case")}</DataHeadCell>
            <DataHeadCell>{tx("status", "Status")}</DataHeadCell>
            <DataHeadCell>{tx("updatedAt", "Last update")}</DataHeadCell>
            {manage ? <DataHeadCell align="end">{tx("actionCol", "Action")}</DataHeadCell> : null}
          </DataHead>
          <tbody>
            {rows.map((row) => {
              const busy = busyId === row.id;
              return (
                <DataRow key={row.id} selected={busy}>
                  <DataCell className="whitespace-nowrap">
                    {row.official_number
                      ? <Ltr className="font-semibold text-ink">{row.official_number}</Ltr>
                      : <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink-muted">{tx("awaitingNumber", "Awaiting number")}</span>}
                  </DataCell>
                  <DataCell className="text-ink-muted"><Ltr>{row.slot_index}</Ltr></DataCell>
                  <DataCell><Link className="font-medium text-accent" to={`/bookings/${row.booking_id}`}><Ltr>{row.booking_number}</Ltr></Link></DataCell>
                  <DataCell>{row.case_id ? <Link className="font-medium text-accent" to={`/export-cases/${row.case_id}`}><Ltr>{row.case_reference}</Ltr></Link> : <span className="text-ink-muted">{tx("unlinkedBooking", "Not linked")}</span>}</DataCell>
                  <DataCell>
                    <div className="flex flex-col gap-1.5">
                      <StatusBadge value={row.status} />
                      <JourneyRail status={row.status} />
                    </div>
                  </DataCell>
                  <DataCell className="whitespace-nowrap text-xs text-ink-muted"><Ltr>{formatWhen(row.updated_at, i18n.language)}</Ltr></DataCell>
                  {manage ? (
                    <DataCell align="end">
                      <div className="flex justify-end">
                        <ContainerActions row={row} busy={busy} onMove={(next) => moveContainer(row, next)} />
                      </div>
                    </DataCell>
                  ) : null}
                </DataRow>
              );
            })}
          </tbody>
        </DataFrame>
      ) : null}

      {rows.length ? (
        <DataCards>
          {rows.map((row) => {
            const busy = busyId === row.id;
            return (
              <DataCard
                key={row.id}
                className={busy ? "opacity-70" : undefined}
                title={row.official_number ? <Ltr>{row.official_number}</Ltr> : <span className="text-sm font-medium text-ink-muted">{tx("awaitingNumber", "Awaiting number")}</span>}
                meta={<>{tx("slot", "Slot")} <Ltr>{row.slot_index}</Ltr> · <Link className="font-medium text-accent" to={`/bookings/${row.booking_id}`}><Ltr>{row.booking_number}</Ltr></Link></>}
                badge={<StatusBadge value={row.status} />}
              >
                <JourneyRail status={row.status} />
                <p className="mt-2 text-xs text-ink-muted">
                  {row.case_id ? <Link className="font-medium text-accent" to={`/export-cases/${row.case_id}`}><Ltr>{row.case_reference}</Ltr></Link> : <span className="text-ink-muted">{tx("unlinkedBooking", "Not linked")}</span>}
                  {" · "}
                  <Ltr>{formatWhen(row.updated_at, i18n.language)}</Ltr>
                </p>
                {manage ? <div className="mt-3"><ContainerActions row={row} busy={busy} onMove={(next) => moveContainer(row, next)} /></div> : null}
              </DataCard>
            );
          })}
        </DataCards>
      ) : null}
    </div>
  );
}
