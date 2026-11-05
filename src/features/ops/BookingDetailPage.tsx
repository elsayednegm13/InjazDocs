import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { AlertText, Ltr } from "@/components/ui/chrome";
import { Field, Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { can, useSession } from "@/app/access";
import { CustomFieldsPanel } from "@/features/fields/CustomFieldsPanel";
import { PageSkeleton } from "@/components/ui/skeleton";
import { api, uploadFile } from "@/lib/api";
import { useContainerStatusMutation } from "@/lib/containers";
import { formatWhen, useCopy } from "@/lib/copy";
import { notifyError, notifySuccess } from "@/lib/notify";
import { nextContainerStatuses } from "@shared/container-flow";

import { JourneyRail } from "./ops-parts";

export function BookingDetailPage() {
  const { tx, fail, i18n } = useCopy();
  const user = useSession();
  const { id } = useParams();
  const client = useQueryClient();
  const moveStatus = useContainerStatusMutation({ bookingId: id ? String(id) : undefined });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(0);
  const query = useQuery({
    queryKey: ["booking", id],
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    queryFn: async () =>
      (await api<{
        booking: Record<string, string | number>;
        containers: Array<Record<string, string | number>>;
        attachments: Array<Record<string, string>>;
        aggregate: Record<string, number | string>;
      }>(`/api/v1/bookings/${id}`)).data,
  });
  const assignNumber = useMutation({
    mutationFn: (input: { containerId: string; officialNumber: string; override: boolean; version: string | number }) =>
      api(`/api/v1/containers/${input.containerId}/number`, {
        method: "POST",
        body: JSON.stringify({ officialNumber: input.officialNumber, override: input.override, version: Number(input.version) }),
      }),
    onSuccess: (_data, input) => {
      notifySuccess(tx("numberAssigned", "Container number assigned"), String(input.officialNumber));
      void client.invalidateQueries({ queryKey: ["booking", id] });
      void client.invalidateQueries({ queryKey: ["containers"] });
      void client.invalidateQueries({ queryKey: ["case"] });
    },
    onError: (error) => notifyError(error),
  });
  if (query.isLoading) return <PageSkeleton cards={3} rows={4} />;
  if (!query.data) return <p className="text-danger">{tx("bookingMissing", "Booking not found.")}</p>;
  const { booking, containers, attachments } = query.data;
  const assigned = containers.filter((slot) => String(slot.official_number || "").trim()).length;
  return (
    <div className="space-y-4" data-booking="loaded">
      <header className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{tx("bookings", "Bookings")}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink"><Ltr>{String(booking.booking_number)}</Ltr></h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusBadge value={String(booking.status)} />
              {booking.case_id ? (
                <Link className="text-sm font-medium text-accent" to={`/export-cases/${String(booking.case_id)}`}>{tx("openFullCase", "Open full case")}</Link>
              ) : (
                <Link className="text-sm font-medium text-accent" to={`/export-cases/new?bookingId=${String(booking.id)}`}>{tx("createCaseAndLink", "Create the export case and link this booking")}</Link>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">{tx("ucr", "UCR (optional)")}: <Ltr>{String(booking.ucr || tx("notUsed", "not used"))}</Ltr></p>
          </div>
          <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border border-line bg-card px-2.5 text-xs font-medium shadow-sm transition duration-[180ms] ease-out has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${uploading ? "text-ink-muted" : "text-ink"}`}>
            {uploading ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
                {tx("uploading", "Uploading…")} {uploading}%
              </>
            ) : (
              tx("uploadConfirmation", "Upload booking confirmation")
            )}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              disabled={uploading > 0}
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setUploadError(null);
                setUploading(1);
                try {
                  const uploaded = await uploadFile(file, "booking", String(id), (pct) => setUploading(pct));
                  await api(`/api/v1/bookings/${id}/confirmation`, {
                    method: "POST",
                    body: JSON.stringify({ r2Key: uploaded.objectKey, originalName: uploaded.filename }),
                  });
                  notifySuccess(tx("confirmationUploaded", "Booking confirmation uploaded"), file.name);
                  await client.invalidateQueries({ queryKey: ["booking", id] });
                } catch (error) {
                  setUploadError(fail(error));
                  notifyError(error);
                } finally {
                  setUploading(0);
                  input.value = "";
                }
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-paper/60 px-4 py-3 text-xs text-ink-muted">
          <span>{tx("slots", "Slots")}: <strong className="text-ink tabular-nums"><Ltr>{containers.length}</Ltr></strong></span>
          <span>{tx("assigned", "Assigned")}: <strong className="text-ink tabular-nums"><Ltr>{assigned}</Ltr></strong></span>
          <span>{tx("awaitingNumber", "Awaiting number")}: <strong className="text-ink tabular-nums"><Ltr>{containers.length - assigned}</Ltr></strong></span>
          <span>{tx("plannedLoading", "Planned loading")}: <Ltr>{String(booking.planned_loading_date || tx("notConfirmed", "Not yet confirmed"))}</Ltr></span>
          <span>{tx("portOfLoading", "Port of loading")}: <Ltr>{String(booking.port_of_loading || "—")}</Ltr></span>
          <span>{tx("portOfDischarge", "Port of discharge")}: <Ltr>{String(booking.port_of_discharge || "—")}</Ltr></span>
          <span>{tx("plannedEtd", "Planned ETD")}: <Ltr>{String(booking.planned_etd || tx("notConfirmed", "Not yet confirmed"))}</Ltr></span>
          <span>{tx("actualEtd", "Actual ETD")}: <Ltr>{String(booking.actual_etd || tx("notConfirmed", "Not yet confirmed"))}</Ltr></span>
          <span>{tx("plannedEta", "Planned ETA")}: <Ltr>{String(booking.planned_eta || tx("notConfirmed", "Not yet confirmed"))}</Ltr></span>
          <span>{tx("actualArrival", "Actual arrival")}: <Ltr>{String(booking.actual_eta || tx("notConfirmed", "Not yet confirmed"))}</Ltr></span>
        </div>
        {uploadError ? <div className="border-t border-line px-4 py-3"><AlertText>{uploadError}</AlertText></div> : null}
      </header>

      {can(user, "bookings.manage") ? (
        <FormDisclosure
          open={editing}
          onToggle={() => setEditing((open) => !open)}
          title={tx("bookingFacts", "Booking facts")}
          hint={tx("containerCountHint", "Raise the number to add empty containers. Lower it to remove only empty planned ones.")}
          openLabel={tx("editBooking", "Edit booking")}
          closeLabel={tx("cancel", "Cancel")}
        >
        <form
        key={String(booking.version)}
        className="grid gap-3 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const formEl = event.currentTarget;
          const form = new FormData(formEl);
          const text = (name: string) => {
            const value = String(form.get(name) ?? "").trim();
            return value || null;
          };
          try {
            await api(`/api/v1/bookings/${String(booking.id)}`, {
              method: "PUT",
              body: JSON.stringify({
                version: Number(booking.version),
                bookingNumber: String(form.get("bookingNumber") || booking.booking_number),
                ucr: text("ucr"),
                shippingLine: text("shippingLine"),
                vessel: booking.vessel || null,
                voyage: booking.voyage || null,
                portOfLoading: text("portOfLoading"),
                portOfDischarge: text("portOfDischarge"),
                expectedContainers: Number(form.get("expectedContainers") || booking.expected_containers || 0),
                status: booking.status,
                plannedLoadingDate: text("plannedLoadingDate"),
                actualLoadingDate: booking.actual_loading_date || null,
                cutoffDate: booking.cutoff_date || null,
                plannedEtd: text("plannedEtd"),
                actualEtd: booking.actual_etd || null,
                plannedEta: text("plannedEta"),
                actualEta: booking.actual_eta || null,
                notes: booking.notes || null,
              }),
            });
            notifySuccess(tx("bookingUpdated", "Booking updated"));
            setEditing(false);
            await client.invalidateQueries({ queryKey: ["booking", id] });
            await client.invalidateQueries({ queryKey: ["bookings"] });
            await client.invalidateQueries({ queryKey: ["case"] });
          } catch (error) {
            notifyError(error);
          }
        }}
      >
        <Field label={tx("bookingNumber", "Booking number")}><Input name="bookingNumber" required dir="ltr" defaultValue={String(booking.booking_number)} /></Field>
        <Field label={tx("ucr", "UCR")}><Input name="ucr" dir="ltr" defaultValue={String(booking.ucr || "")} /></Field>
        <Field label={tx("shippingLine", "Shipping line")}><Input name="shippingLine" defaultValue={String(booking.shipping_line || "")} /></Field>
        <Field label={tx("expectedContainers", "Expected containers")} hint={tx("containerCountHint", "Raise the number to add empty containers. Lower it to remove only empty planned ones.")}><Input name="expectedContainers" type="number" min={0} max={100} dir="ltr" defaultValue={String(booking.expected_containers || 0)} /></Field>
        <Field label={tx("plannedLoading", "Planned loading")}><Input name="plannedLoadingDate" type="date" dir="ltr" defaultValue={String(booking.planned_loading_date || "").slice(0, 10)} /></Field>
        <Field label={tx("plannedEtd", "Planned ETD")}><Input name="plannedEtd" type="date" dir="ltr" defaultValue={String(booking.planned_etd || "").slice(0, 10)} /></Field>
        <Field label={tx("plannedEta", "Planned ETA")}><Input name="plannedEta" type="date" dir="ltr" defaultValue={String(booking.planned_eta || "").slice(0, 10)} /></Field>
        <Field label={tx("portOfLoading", "Port of loading")}><Input name="portOfLoading" defaultValue={String(booking.port_of_loading || "")} /></Field>
        <Field label={tx("portOfDischarge", "Port of discharge")}><Input name="portOfDischarge" defaultValue={String(booking.port_of_discharge || "")} /></Field>
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" size="sm">{tx("saveBooking", "Save booking")}</Button>
        </div>
      </form>
        </FormDisclosure>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {containers.map((slot) => {
          const number = String(slot.official_number || "").trim();
          const busy = moveStatus.isPending && moveStatus.variables?.id === String(slot.id);
          const next = nextContainerStatuses(String(slot.status)).filter((status) => !(status === "NUMBER_ASSIGNED" && !number));
          return (
            <section key={String(slot.id)} className={`flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)] transition ${busy ? "opacity-70" : ""}`}>
              <div className="flex flex-1 flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    {tx("slot", "Slot")} <Ltr>{String(slot.slot_index)}</Ltr>
                  </p>
                  <p className="mt-1 text-lg font-semibold text-ink">
                    {number ? <Ltr>{number}</Ltr> : <span className="text-sm font-medium text-ink-muted">{tx("numberNotAssigned", "number not assigned")}</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <StatusBadge value={String(slot.status)} />
                    <JourneyRail status={String(slot.status)} />
                  </div>
                </div>
                {next.length ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={busy} onClick={() => moveStatus.mutate({ id: String(slot.id), status: next[0], version: slot.version })}>
                      {tx(`status.${next[0]}`, next[0])}
                    </Button>
                    {next.length > 1 ? (
                      <Select
                        className="h-8 w-auto px-1.5 text-xs"
                        value=""
                        aria-label={tx("otherStage", "Other stage…")}
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value) moveStatus.mutate({ id: String(slot.id), status: event.target.value, version: slot.version });
                        }}
                      >
                        <option value="">{tx("otherStage", "Other stage…")}</option>
                        {next.slice(1).map((status) => (
                          <option key={status} value={status}>{tx(`status.${status}`, status)}</option>
                        ))}
                      </Select>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {!number ? (
                <form
                  className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formEl = event.currentTarget;
                    const form = new FormData(formEl);
                    assignNumber.mutate(
                      { containerId: String(slot.id), officialNumber: String(form.get("officialNumber") || ""), override: form.get("override") === "1", version: slot.version },
                      { onSuccess: () => formEl.reset() },
                    );
                  }}
                >
                  <Input name="officialNumber" placeholder="MSCU1234567" dir="ltr" className="max-w-44" />
                  <label className="text-xs text-ink-muted"><input type="checkbox" name="override" value="1" className="h-4 w-4 accent-accent" /> {tx("overrideIso", "Override ISO check")}</label>
                  <Button size="sm" variant="outline" type="submit" disabled={assignNumber.isPending}>{tx("assignNumber", "Assign number")}</Button>
                </form>
              ) : null}
              <details className="border-t border-line">
                <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-ink-muted">{tx("customFields", "Custom fields")}</summary>
                <div className="px-4 pb-4">
                  <CustomFieldsPanel endpoint={`/api/v1/containers/${String(slot.id)}/custom-fields`} draft={slot.status === "PLANNED" || slot.status === "CANCELLED"} />
                </div>
              </details>
            </section>
          );
        })}
      </div>

      {attachments?.length ? (
        <section className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="text-[15px] font-semibold text-ink">{tx("attachments", "Attachments")}</h2>
          <ul className="mt-3 space-y-2">
            {attachments.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 bg-paper/40 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{file.original_name}</span>
                <a
                  className="shrink-0 rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium hover:border-accent/40"
                  href={`/api/v1/files/download?key=${encodeURIComponent(file.r2_key)}&inline=1`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tx("openFile", "Open file")}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <CustomFieldsPanel endpoint={`/api/v1/bookings/${id}/custom-fields`} draft={booking.status === "DRAFT" || booking.status === "CANCELLED"} />
      <p className="text-xs text-ink-muted">
        {tx("updatedAt", "Last update")}: <Ltr>{formatWhen(String(booking.updated_at || ""), i18n.language)}</Ltr>
      </p>
    </div>
  );
}
