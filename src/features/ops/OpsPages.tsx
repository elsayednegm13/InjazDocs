import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Ltr, PageHeader } from "@/components/ui/chrome";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { CustomFieldsPanel } from "@/features/fields/CustomFieldsPanel";
import { api, uploadFile } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { csvToRecords } from "@shared/csv";

export function BookingsListPage() {
  const { tx } = useCopy();
  const query = useQuery({
    queryKey: ["bookings"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/bookings")).data,
  });
  return (
    <ListTable
      title={tx("bookings", "Bookings")}
      loading={query.isLoading}
      error={query.isError}
      empty={!query.data?.length}
      rows={query.data ?? []}
      columns={["booking_number", "customer_name", "status", "planned_etd", "planned_eta"]}
      href={(row) => `/bookings/${row.id}`}
    />
  );
}

export function BookingDetailPage() {
  const { tx } = useCopy();
  const { id } = useParams();
  const query = useQuery({
    queryKey: ["booking", id],
    queryFn: async () =>
      (await api<{
        booking: Record<string, string | number>;
        containers: Array<Record<string, string | number>>;
        attachments: Array<Record<string, string>>;
        aggregate: Record<string, number | string>;
      }>(`/api/v1/bookings/${id}`)).data,
  });
  if (query.isLoading) return <p>{tx("loadingBooking", "Loading booking…")}</p>;
  if (!query.data) return <p className="text-danger">{tx("bookingMissing", "Booking not found.")}</p>;
  const { booking, containers, attachments } = query.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{String(booking.booking_number)}</h1>
      <p className="text-sm text-ink-muted">{tx("ucr", "UCR (optional)")} <Ltr>{String(booking.ucr || tx("notUsed", "not used"))}</Ltr></p>
      <p className="text-sm font-medium">
        {tx("slots", "Slots")} <Ltr>{containers.length}</Ltr>
        {" · "}
        {tx("assigned", "Assigned")} <Ltr>{containers.filter((slot) => String(slot.official_number || "").trim()).length}</Ltr>
        {" · "}
        {tx("awaitingNumber", "Awaiting number")} <Ltr>{containers.filter((slot) => !String(slot.official_number || "").trim()).length}</Ltr>
      </p>
      <p>{tx("plannedEtd", "Planned ETD")} <Ltr>{String(booking.planned_etd || tx("notConfirmed", "Not yet confirmed"))}</Ltr> · {tx("actualEtd", "Actual ETD")} <Ltr>{String(booking.actual_etd || tx("notConfirmed", "Not yet confirmed"))}</Ltr></p>
      <p>{tx("plannedEta", "Planned ETA")} <Ltr>{String(booking.planned_eta || tx("notConfirmed", "Not yet confirmed"))}</Ltr> · {tx("actualArrival", "Actual arrival")} <Ltr>{String(booking.actual_eta || tx("notConfirmed", "Not yet confirmed"))}</Ltr></p>
      <ul className="text-sm">{attachments?.map((file) => <li key={file.id}>{file.original_name}</li>)}</ul>
      <CustomFieldsPanel endpoint={`/api/v1/bookings/${id}/custom-fields`} draft={booking.status === "DRAFT" || booking.status === "CANCELLED"} />
      <label className="inline-flex cursor-pointer items-center rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium">
        {tx("chooseFile", "Choose file")}
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const uploaded = await uploadFile(file, "booking", String(id));
            await api(`/api/v1/bookings/${id}/confirmation`, {
              method: "POST",
              body: JSON.stringify({ r2Key: uploaded.objectKey, originalName: uploaded.filename }),
            });
            window.location.reload();
          }}
        />
      </label>
      <div className="space-y-2">
        {containers.map((c) => (
          <div key={String(c.id)} className="rounded-xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>{tx("slot", "Slot")} {String(c.slot_index)} · <Ltr>{String(c.official_number || tx("numberNotAssigned", "number not assigned"))}</Ltr> · <StatusBadge value={String(c.status)} /></div>
            </div>
            <form
              className="mt-2 flex flex-wrap gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                await api(`/api/v1/containers/${c.id}/number`, {
                  method: "POST",
                  body: JSON.stringify({ officialNumber: form.get("officialNumber"), override: form.get("override") === "1", version: c.version }),
                });
                window.location.reload();
              }}
            >
              <Input name="officialNumber" placeholder="MSCU1234567" />
              <label className="text-sm"><input type="checkbox" name="override" value="1" /> {tx("overrideIso", "Override ISO check")}</label>
              <Button size="sm" type="submit">{tx("assignNumber", "Assign number")}</Button>
            </form>
            <div className="mt-3">
              <CustomFieldsPanel endpoint={`/api/v1/containers/${String(c.id)}/custom-fields`} draft={c.status === "PLANNED" || c.status === "CANCELLED"} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {["GATED_IN", "LOADED", "DEPARTED", "ARRIVED_PORT", "CUSTOMS_RELEASED", "DELIVERED_TO_CUSTOMER"].map((status) => (
                <Button key={status} size="sm" variant="outline" onClick={async () => {
                  await api(`/api/v1/containers/${c.id}/status`, { method: "POST", body: JSON.stringify({ status, version: c.version }) });
                  window.location.reload();
                }}>{tx(`status.${status}`, status)}</Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SchedulePage() {
  const { tx } = useCopy();
  const query = useQuery({
    queryKey: ["schedule"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/schedule")).data,
  });
  return (
    <div className="space-y-4">
      <PageHeader title={tx("schedule", "Shipping schedule")} subtitle={tx("scheduleHint", "Planned dates are distinct from actuals. Empty dates mean not yet confirmed.")} />
      {Object.entries(
        (query.data ?? []).reduce<Record<string, Array<Record<string, string>>>>((groups, row) => {
          const key = row.planned_etd || row.planned_loading_date || tx("notConfirmed", "Not yet confirmed");
          groups[key] ??= [];
          groups[key].push(row);
          return groups;
        }, {}),
      ).map(([when, rows]) => (
        <section key={when} className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)]">
          <h2 className="bg-[#14304a] px-4 py-2 text-sm font-semibold text-white">
            {tx("etd", "ETD")} <Ltr>{when}</Ltr>
          </h2>
          <div className="hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper"><tr>{[tx("case", "Case"), tx("bookings", "Bookings"), tx("load", "Load"), tx("cutoff", "Cutoff"), tx("eta", "ETA")].map((h) => <th key={h} className="p-3 text-start">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="p-3"><Link className="underline" to={`/export-cases/${row.case_id}`}>{row.case_reference}</Link></td>
                    <td className="p-3"><Link className="underline" to={`/bookings/${row.id}`}>{row.booking_number}</Link></td>
                    <td className="p-3"><Ltr>{row.actual_loading_date || row.planned_loading_date || tx("notConfirmed", "Not yet confirmed")}</Ltr></td>
                    <td className="p-3"><Ltr>{row.cutoff_date || tx("notConfirmed", "Not yet confirmed")}</Ltr></td>
                    <td className="p-3"><Ltr>{row.actual_eta || row.planned_eta || tx("notConfirmed", "Not yet confirmed")}</Ltr></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 p-4">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl border border-line p-3 text-sm">
                <Link className="font-semibold text-accent" to={`/bookings/${row.id}`}><Ltr>{row.booking_number}</Ltr></Link>
                <p><Link to={`/export-cases/${row.case_id}`}>{row.case_reference}</Link></p>
                <p className="text-ink-muted">{tx("eta", "ETA")} <Ltr>{row.actual_eta || row.planned_eta || tx("notConfirmed", "Not yet confirmed")}</Ltr></p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ContainersPage() {
  const { tx } = useCopy();
  const query = useQuery({
    queryKey: ["containers"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/containers")).data,
  });
  return (
    <ListTable
      title={tx("containers", "Containers")}
      loading={query.isLoading}
      error={query.isError}
      empty={!query.data?.length}
      rows={query.data ?? []}
      columns={["official_number", "status", "booking_number", "case_reference"]}
      href={(row) => `/bookings/${row.booking_id}`}
    />
  );
}

export function RemindersPage() {
  const { tx, stored, i18n } = useCopy();
  const query = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/reminders")).data,
  });
  return (
    <div className="space-y-4">
      <PageHeader title={tx("reminders", "Reminders")} />
      {query.data?.map((r) => (
        <div key={r.id} className="rounded-xl border border-line bg-card p-4">
          <div className="flex justify-between gap-3">
            <div>
              <Link className="font-medium underline" to={`/export-cases/${r.case_id}`}>{r.case_reference}</Link>
              <p>{stored(r.reason)}</p>
              <p className="text-sm text-ink-muted">{stored(r.next_action)} · {tx("due", "due")} <Ltr>{r.due_at}</Ltr></p>
            </div>
            <StatusBadge value={r.status} />
          </div>
          {r.status === "SNOOZED" ? (
            <p className="mt-2 text-sm text-ink-muted">{tx("snoozedUntil", "Snoozed")} <Ltr>{r.snoozed_until || ""}</Ltr></p>
          ) : (
            <div className="mt-2 flex gap-2">
              {[1, 2].map((days) => (
                <Button key={days} size="sm" variant="outline" onClick={async () => {
                  const until = new Date(Date.now() + days * 86400000).toISOString();
                  await api(`/api/v1/reminders/${r.id}/snooze`, { method: "POST", body: JSON.stringify({ until }) });
                  window.location.reload();
                }}>{i18n.language.startsWith("ar") ? `${tx("snooze", "Snooze")} ${days}` : `Snooze ${days}d`}</Button>
              ))}
            </div>
          )}
        </div>
      ))}
      {!query.data?.length ? <p className="text-ink-muted">{tx("noRemindersView", "No reminders in this view.")}</p> : null}
    </div>
  );
}

export function NotificationsPage() {
  const { tx, stored } = useCopy();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api<Array<Record<string, string | number>>>("/api/v1/notifications")).data,
  });
  return (
    <div className="space-y-3">
      <PageHeader title={tx("notifications", "Notifications")} />
      {query.data?.map((n) => (
        <button
          key={String(n.id)}
          className="block w-full rounded-xl border border-line bg-card p-4 text-start"
          onClick={async () => {
            await api(`/api/v1/notifications/${n.id}/read`, { method: "POST" });
            window.location.href = `/export-cases/${n.case_id}`;
          }}
        >
          <div className="font-medium">{String(n.case_reference)}</div>
          <div className="text-sm">{stored(String(n.reason))}</div>
        </button>
      ))}
      {!query.data?.length ? <p className="text-ink-muted">{tx("inboxEmpty", "Inbox is empty.")}</p> : null}
    </div>
  );
}

export function ReportsPage() {
  const { tx } = useCopy();
  const query = useQuery({
    queryKey: ["delays"],
    queryFn: async () => (await api<Record<string, unknown>>("/api/v1/reports/delays")).data,
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title={tx("reports", "Reports")} actions={<a className="text-sm font-medium text-accent underline" href="/api/v1/exports/csv">{tx("downloadCsv", "Download cases CSV")}</a>} />
      </div>
      <div className="grid gap-3 rounded-2xl border border-line bg-card p-4 text-sm shadow-[var(--shadow-card)] md:grid-cols-2">
        <p>{tx("bankReviewAvg", "Average bank review days")} · <Ltr>{String(query.data?.averageBankReviewDays ?? tx("none", "none"))}</Ltr></p>
        <p>{tx("docsPending", "Documents pending")} · <Ltr>{String(query.data?.incompleteRequiredDocuments ?? 0)}</Ltr></p>
        <p>{tx("bookings", "Bookings")} · <Ltr>{String(query.data?.bookingVolume ?? 0)}</Ltr></p>
        <p>{tx("status.DELIVERED_TO_CUSTOMER", "Delivered to customer")} · <Ltr>{String(query.data?.containersDelivered ?? 0)}</Ltr></p>
      </div>
      <ImportCustomers />
    </div>
  );
}

type ImportPreview = {
  valid: { legalName: string; countryCode?: string; phone?: string }[];
  errors: { row: number; code?: string; message: string }[];
  canCommit: boolean;
};

function ImportCustomers() {
  const { tx, fail } = useCopy();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-xl border border-line bg-card p-4" data-testid="import-preview">
      <h2 className="mb-2 font-medium">{tx("customerImport", "Customer CSV import")}</h2>
      <p className="mb-2 text-sm text-ink-muted">{tx("importHint", "Preview never writes. Commit is refused when any row is invalid.")}</p>
      <p className="mb-3 text-sm text-ink-muted">{tx("importNothingSaved", "Nothing is saved. This screen only previews the file.")}</p>
      <input
        type="file"
        accept=".csv"
        aria-label={tx("customerImport", "Customer CSV import")}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setError(null);
          try {
            const text = await file.text();
            const rows = csvToRecords(text);
            const res = await api<ImportPreview>("/api/v1/imports/customers/preview", { method: "POST", body: JSON.stringify({ rows }) });
            setPreview(res.data);
          } catch (err) {
            setPreview(null);
            setError(fail(err));
          }
        }}
      />
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {preview ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            {tx("importReady", "Rows that can be reviewed")}: <Ltr>{preview.valid.length}</Ltr>
            {" · "}
            {tx("importBlocked", "Rows that need a correction")}: <Ltr>{preview.errors.length}</Ltr>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-0 text-sm">
              <thead className="bg-paper">
                <tr>
                  {[tx("importColRow", "Row"), tx("legalName", "Legal name"), tx("country", "Country"), tx("phone", "Phone"), tx("status", "Status")].map((heading) => (
                    <th key={heading} className="p-2 text-start">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.valid.map((row, index) => (
                  <tr key={`ok-${index}`} className="border-t border-line">
                    <td className="p-2"><Ltr>{index + 2}</Ltr></td>
                    <td className="p-2">{row.legalName}</td>
                    <td className="p-2"><Ltr>{row.countryCode || "—"}</Ltr></td>
                    <td className="p-2"><Ltr>{row.phone || "—"}</Ltr></td>
                    <td className="p-2">{tx("importRowReady", "Ready to review")}</td>
                  </tr>
                ))}
                {preview.errors.map((row) => (
                  <tr key={`bad-${row.row}`} className="border-t border-line">
                    <td className="p-2"><Ltr>{row.row}</Ltr></td>
                    <td className="p-2" colSpan={3}>{tx(`import.err.${row.code ?? "UNKNOWN"}`, tx("importRowNeedsFix", "This row needs a correction."))}</td>
                    <td className="p-2 text-danger">{tx("importRowNeedsFix", "This row needs a correction.")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ListTable({
  title,
  rows,
  columns,
  href,
  loading,
  error,
  empty,
}: {
  title: string;
  rows: Array<Record<string, string>>;
  columns: string[];
  href: (row: Record<string, string>) => string;
  loading: boolean;
  error: boolean;
  empty: boolean;
}) {
  const { tx } = useCopy();
  return (
    <div className="space-y-4">
      <PageHeader title={title} />
      {loading ? <p>{tx("loadingData", "Loading…")}</p> : null}
      {error ? <p className="text-danger">{tx("loadFailed", "Could not load data.")}</p> : null}
      {empty && !loading ? <p className="text-ink-muted">{tx("empty", "Nothing here yet.")}</p> : null}
      <div className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <Link key={row.id} className="rounded-2xl border border-line bg-card p-4" to={href(row)}>
            <p className="font-semibold"><Ltr>{row[columns[0]] || "—"}</Ltr></p>
            <p className="mt-1 text-sm text-ink-muted">{columns.slice(1).map((c) => row[c]).filter(Boolean).join(" · ")}</p>
          </Link>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-xl border border-line bg-card md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-paper"><tr>{columns.map((c) => <th key={c} className="p-3 text-start">{tx(`col.${c}`, c.replaceAll("_", " "))}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                {columns.map((c, i) => (
                  <td key={c} className="p-3">
                    {i === 0 ? <Link className="underline" to={href(row)}><Ltr>{row[c] || "—"}</Ltr></Link> : <Ltr>{row[c] || "—"}</Ltr>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

