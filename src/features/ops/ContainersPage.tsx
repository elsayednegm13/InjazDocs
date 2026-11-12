import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Boxes, CheckCircle2, CircleDashed, Ship } from "lucide-react";
import { can, useSession } from "@/app/access";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader, StatCard } from "@/components/ui/chrome";
import { DataCard, DataCards, DataCell, DataFrame, DataHead, DataHeadCell, DataRow } from "@/components/ui/data-view";
import { Select } from "@/components/ui/input";
import { ListToolbar, PaginationFooter, useListController } from "@/components/ui/list-toolbar";
import { StatusBadge } from "@/components/ui/status";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useContainerStatusMutation } from "@/lib/containers";
import { formatWhen, useCopy } from "@/lib/copy";
import { nextContainerStatuses } from "@shared/container-flow";

import { JourneyRail } from "./ops-parts";

const CONTAINER_FILTERS = [
  "PLANNED",
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
  const move = useContainerStatusMutation();

  const query = useQuery({
    queryKey: ["containers"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/containers")).data,
    placeholderData: keepPreviousData,
  });

  const allRows = query.data ?? [];

  const list = useListController(allRows, {
    storageKey: "containers",
    searchText: (row) =>
      [row.official_number, row.booking_number, row.case_reference, row.seal_number, row.status]
        .filter(Boolean)
        .join(" "),
    statusOf: (row) => row.status ?? "",
    dateOf: (row) => row.created_at || row.updated_at,
    idOf: (row) => row.id,
  });

  const counts = {
    total: allRows.length,
    awaiting: allRows.filter((row) => row.status === "PLANNED").length,
    transit: allRows.filter((row) => ["GATED_IN", "LOADED", "DEPARTED"].includes(row.status)).length,
    delivered: allRows.filter((row) => row.status === "DELIVERED_TO_CUSTOMER").length,
  };
  const busyId = move.isPending ? move.variables?.id : null;
  const moveContainer = (row: Record<string, string>, next: string) =>
    move.mutate({ id: row.id, status: next, version: row.version });

  const statusOptions = CONTAINER_FILTERS.map((value) => ({
    value,
    label: tx(`status.${value}`, value),
  }));

  const exportColumns = [
    { header: tx("containers", "Container"), value: (r: Record<string, string>) => r.official_number || tx("awaitingNumber", "Awaiting number") },
    { header: tx("slot", "Slot"), value: (r: Record<string, string>) => Number(r.slot_index || 1) },
    { header: tx("bookings", "Booking"), value: (r: Record<string, string>) => r.booking_number || "—" },
    { header: tx("case", "Case"), value: (r: Record<string, string>) => r.case_reference || tx("unlinkedBooking", "Not linked") },
    { header: tx("status", "Status"), value: (r: Record<string, string>) => tx(`status.${r.status}`, r.status) },
    { header: tx("updatedAt", "Last update"), value: (r: Record<string, string>) => (r.updated_at || r.created_at || "").slice(0, 10) },
  ];

  return (
    <div className="space-y-4" data-containers={query.isLoading ? "loading" : "ready"}>
      <PageHeader title={tx("containers", "Containers")} subtitle={tx("containersHint", "Move a container along its journey here: the row updates instantly, no refresh.")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={tx("containers", "Containers")} value={counts.total} icon={<Boxes className="h-5 w-5" />} tone="blue" hint={tx("containerSummaryHint", "Summary of the containers listed below.")} />
        <StatCard label={tx("awaitingNumber", "Awaiting number")} value={counts.awaiting} icon={<CircleDashed className="h-5 w-5" />} tone="amber" />
        <StatCard label={tx("inTransit", "In transit")} value={counts.transit} icon={<Ship className="h-5 w-5" />} tone="teal" />
        <StatCard label={tx("deliveredToCustomer", "Delivered to customer")} value={counts.delivered} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>

      <ListToolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={tx("searchContainer", "Search by container or booking number")}
        searchAriaLabel={tx("searchContainer", "Search by container or booking number")}
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
          filename: "exportflow-containers",
          sheetName: tx("containers", "Containers"),
          columns: exportColumns,
          rows: list.filteredRows,
        }}
      />

      {query.isLoading ? <ResponsiveListSkeleton rows={5} columns={5} /> : null}
      {!query.isLoading && list.pagedRows.length === 0 ? <EmptyState>{tx("noContainers", "No containers match this filter.")}</EmptyState> : null}

      {list.pagedRows.length ? (
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
            {list.pagedRows.map((row) => {
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

      {list.pagedRows.length ? (
        <DataCards>
          {list.pagedRows.map((row) => {
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
