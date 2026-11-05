import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Boxes, CheckCircle2, CircleDashed, Search, Ship } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { EmptyState, Ltr, PageHeader, StatCard } from "@/components/ui/chrome";
import { DataCard, DataCards, DataCell, DataFrame, DataHead, DataHeadCell, DataRow } from "@/components/ui/data-view";
import { Field, Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { ResponsiveListSkeleton } from "@/components/ui/skeleton";
import { can, useSession } from "@/app/access";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { formatDay, useCopy } from "@/lib/copy";

import { FilterChip } from "./ops-parts";

export function BookingsListPage() {
  const { tx, i18n } = useCopy();
  const user = useSession();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ["bookings", q],
    queryFn: async () => {
      const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
      return (await api<Array<Record<string, string>>>(`/api/v1/bookings${suffix}`)).data;
    },
    placeholderData: keepPreviousData,
  });
  const allRows = query.data ?? [];
  const rows = allRows.filter((row) => !status || row.status === status);
  const counts = {
    total: allRows.length,
    drafts: allRows.filter((row) => ["DRAFT", "REQUESTED"].includes(row.status)).length,
    moving: allRows.filter((row) => ["LOADING_IN_PROGRESS", "LOADED", "DEPARTED", "ARRIVED_PORT"].includes(row.status)).length,
    closed: allRows.filter((row) => row.status === "CLOSED").length,
  };
  return (
    <div className="space-y-4" data-bookings={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("bookings", "Shipping bookings")}
        subtitle={tx("bookingsHint", "Create the sea booking before the export case. Link it when loading starts.")}
      />
      {can(user, "bookings.manage") ? (
        <FormDisclosure
          open={creating}
          onToggle={() => setCreating((open) => !open)}
          title={tx("createSeaBooking", "New sea booking")}
          hint={tx("bookingFirstHint", "Create the sea booking first, with the UCR, container count, loading date, arrival, and both ports. Link it here when the export case starts.")}
          openLabel={tx("createSeaBooking", "New sea booking")}
          closeLabel={tx("cancel", "Cancel")}
        >
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            const formEl = event.currentTarget;
            const form = new FormData(formEl);
            setSaving(true);
            try {
              const created = await api<{ id: string }>("/api/v1/bookings", {
                method: "POST",
                body: JSON.stringify({
                  bookingNumber: form.get("bookingNumber"),
                  ucr: form.get("ucr") || undefined,
                  shippingLine: form.get("shippingLine") || undefined,
                  expectedContainers: Number(form.get("expectedContainers") || 0),
                  plannedLoadingDate: form.get("plannedLoadingDate") || undefined,
                  plannedEta: form.get("plannedEta") || undefined,
                  portOfLoading: form.get("portOfLoading") || undefined,
                  portOfDischarge: form.get("portOfDischarge") || undefined,
                }),
              });
              notifySuccess(tx("bookingCreated", "Booking created"));
              await client.invalidateQueries({ queryKey: ["bookings"] });
              void navigate(`/bookings/${created.data.id}`);
            } catch (error) {
              notifyError(error);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label={tx("bookingNumber", "Booking number")}><Input name="bookingNumber" required dir="ltr" /></Field>
          <Field label={tx("ucr", "UCR")}><Input name="ucr" dir="ltr" /></Field>
          <Field label={tx("shippingLine", "Shipping line")}><Input name="shippingLine" /></Field>
          <Field label={tx("expectedContainers", "Expected containers")}><Input name="expectedContainers" type="number" min={0} defaultValue={1} dir="ltr" /></Field>
          <Field label={tx("plannedLoading", "Planned loading")}><Input name="plannedLoadingDate" type="date" dir="ltr" /></Field>
          <Field label={tx("plannedEta", "Planned ETA")}><Input name="plannedEta" type="date" dir="ltr" /></Field>
          <Field label={tx("portOfLoading", "Port of loading")}><Input name="portOfLoading" /></Field>
          <Field label={tx("portOfDischarge", "Port of discharge")}><Input name="portOfDischarge" /></Field>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={saving}>{tx("createBooking", "Create booking")}</Button>
          </div>
        </form>
        </FormDisclosure>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={tx("bookings", "Bookings")} value={counts.total} icon={<Ship className="h-5 w-5" />} tone="blue" />
        <StatCard label={tx("status.DRAFT", "Draft")} value={counts.drafts} icon={<CircleDashed className="h-5 w-5" />} tone="amber" />
        <StatCard label={tx("inProgress", "In progress")} value={counts.moving} icon={<Ship className="h-5 w-5" />} tone="teal" />
        <StatCard label={tx("status.CLOSED", "Closed")} value={counts.closed} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-card p-4 shadow-card">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-ink-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tx("searchBooking", "Search by booking or case reference")}
            aria-label={tx("searchBooking", "Search by booking or case reference")}
            className="border-line bg-paper ps-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={!status} onClick={() => setStatus("")}>{tx("allStatuses", "All statuses")}</FilterChip>
          {BOOKING_FILTERS.map((value) => (
            <FilterChip key={value} active={status === value} onClick={() => setStatus(status === value ? "" : value)}>
              {tx(`status.${value}`, value.replaceAll("_", " "))}
            </FilterChip>
          ))}
        </div>
      </div>

      {query.isLoading ? <ResponsiveListSkeleton rows={5} columns={5} /> : null}
      {!query.isLoading && rows.length === 0 ? <EmptyState>{tx("noBookings", "No bookings match this filter.")}</EmptyState> : null}

      {rows.length ? (
        <DataFrame label={tx("bookings", "Shipping bookings")} className="min-w-[1000px]">
          <DataHead>
            <DataHeadCell>{tx("bookingNumber", "Booking number")}</DataHeadCell>
            <DataHeadCell>{tx("customer", "Customer")}</DataHeadCell>
            <DataHeadCell>{tx("case", "Case")}</DataHeadCell>
            <DataHeadCell>{tx("plannedEtd", "Planned ETD")}</DataHeadCell>
            <DataHeadCell>{tx("plannedEta", "Planned ETA")}</DataHeadCell>
            <DataHeadCell>{tx("slots", "Slots")}</DataHeadCell>
            <DataHeadCell>{tx("status", "Status")}</DataHeadCell>
            <DataHeadCell align="end">{tx("actionCol", "Action")}</DataHeadCell>
          </DataHead>
          <tbody>
            {rows.map((row) => (
              <DataRow key={row.id}>
                <DataCell className="whitespace-nowrap">
                  <Link className="inline-flex items-center gap-2 font-semibold text-ink" to={`/bookings/${row.id}`}>
                    <span className="grid h-8 w-8 place-items-center rounded-control bg-accent/10 text-accent"><Ship className="h-4 w-4" aria-hidden /></span>
                    <Ltr>{row.booking_number}</Ltr>
                  </Link>
                </DataCell>
                <DataCell className="max-w-56 truncate text-ink">{row.customer_name || "—"}</DataCell>
                <DataCell>{row.case_id ? <Link className="font-medium text-accent" to={`/export-cases/${row.case_id}`}><Ltr>{row.case_reference}</Ltr></Link> : <span className="text-ink-muted">{tx("unlinkedBooking", "Not linked")}</span>}</DataCell>
                <DataCell className="whitespace-nowrap text-ink-muted"><Ltr>{formatDay(row.planned_etd, i18n.language)}</Ltr></DataCell>
                <DataCell className="whitespace-nowrap text-ink-muted"><Ltr>{formatDay(row.planned_eta, i18n.language)}</Ltr></DataCell>
                <DataCell><span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-muted"><Boxes className="h-3.5 w-3.5" aria-hidden /><Ltr>{row.expected_containers || 0}</Ltr></span></DataCell>
                <DataCell><StatusBadge value={row.status} /></DataCell>
                <DataCell align="end">
                  <Button asChild size="sm" variant="outline"><Link to={`/bookings/${row.id}`}>{tx("openRecord", "Open")}</Link></Button>
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
              title={<Ltr>{row.booking_number}</Ltr>}
              meta={row.customer_name || "—"}
              badge={<StatusBadge value={row.status} />}
            >
              <div className="flex gap-2">
                <div className="flex-1 rounded-control border border-line bg-paper/50 px-2.5 py-1.5 text-xs">
                  <p className="text-[10px] font-semibold uppercase text-ink-muted">{tx("plannedEtd", "Planned ETD")}</p>
                  <p className="mt-0.5 text-ink"><Ltr>{formatDay(row.planned_etd, i18n.language)}</Ltr></p>
                </div>
                <div className="flex-1 rounded-control border border-line bg-paper/50 px-2.5 py-1.5 text-xs">
                  <p className="text-[10px] font-semibold uppercase text-ink-muted">{tx("plannedEta", "Planned ETA")}</p>
                  <p className="mt-0.5 text-ink"><Ltr>{formatDay(row.planned_eta, i18n.language)}</Ltr></p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                {row.case_id ? <Link className="font-medium text-accent" to={`/export-cases/${row.case_id}`}><Ltr>{row.case_reference}</Ltr></Link> : <span className="text-ink-muted">{tx("unlinkedBooking", "Not linked")}</span>}
                <Button asChild size="sm" variant="outline"><Link to={`/bookings/${row.id}`}>{tx("openRecord", "Open")}</Link></Button>
              </div>
            </DataCard>
          ))}
        </DataCards>
      ) : null}
    </div>
  );
}

const BOOKING_FILTERS = [
  "DRAFT",
  "REQUESTED",
  "CONFIRMED",
  "LOADING_IN_PROGRESS",
  "LOADED",
  "DEPARTED",
  "ARRIVED_PORT",
  "CLOSED",
  "CANCELLED",
] as const;
