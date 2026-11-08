import { Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { Ltr } from "@/components/ui/chrome";
import { Field, Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import type { PresentationDiscrepancy } from "@shared/bank-presentation";

export function BankPanel({ caseId, route, status, onDone }: { caseId: string; route: string; status: string; onDone: () => void }) {
  const { tx } = useCopy();
  const [warnings, setWarnings] = useState<PresentationDiscrepancy[] | null>(null);
  const [saving, setSaving] = useState(false);
  async function commit(to: string) {
    if (saving) return;
    setSaving(true);
    try {
      await api(`/api/v1/export-cases/${caseId}/bank/status`, { method: "POST", body: JSON.stringify({ to }) });
      setWarnings(null);
      notifySuccess(tx("bankStageSaved", "Bank stage saved"));
      onDone();
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  }
  async function choose(to: string) {
    if (saving) return;
    if (to !== "HANDED_TO_BANK") {
      await commit(to);
      return;
    }
    try {
      const check = await api<{ discrepancies: PresentationDiscrepancy[] }>(`/api/v1/export-cases/${caseId}/bank/presentation-check`);
      if (check.data.discrepancies.length) {
        setWarnings(check.data.discrepancies);
        return;
      }
    } catch (error) {
      notifyError(error);
      return;
    }
    await commit(to);
  }
  if (route !== "BANK_ROUTE") {
    return (
      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{tx("tabs.bank", "Bank")}</h2>
        <p className="mt-2 text-sm text-ink-muted">{tx("directRouteCopy", "This case uses the direct route. Bank stages are not required and must not block dispatch.")}</p>
        <DirectButtons caseId={caseId} onDone={onDone} />
      </section>
    );
  }
  const steps = ["PREPARING", "SCANNED", "READY_FOR_PHYSICAL_HANDOVER", "HANDED_TO_BANK", "BANK_REVIEW", "CORRECTION_REQUESTED", "BANK_APPROVED"];
  return (
    <section className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{tx("tabs.bank", "Bank")}</h2>
      <p className="mb-3 mt-2 text-sm">{tx("currentBankPath", "Current bank path")}: <StatusBadge value={status} /></p>
      <div className="flex flex-wrap gap-2">
        {steps.map((to) => (
          <Button key={to} data-decision={to} size="sm" variant="outline" type="button" disabled={saving} onClick={() => void choose(to)}>
            {tx(`status.${to}`, to)}
          </Button>
        ))}
      </div>
      <Dialog open={warnings !== null} onOpenChange={(open) => { if (!saving && !open) setWarnings(null); }}>
        <DialogPortal>
          <DialogOverlay className="fixed inset-0 z-40 bg-ink/40" />
          <DialogContent className="fixed left-1/2 top-1/2 z-50 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-card p-5 text-start shadow-card focus:outline-none">
            <DialogTitle className="text-base font-semibold text-ink">{tx("bankHandoverTitle", "Hand documents to the bank")}</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-relaxed text-ink-muted">
              {tx("bankHandoverWarnings", "Review these notes before handover. You can continue after reading them, or go back and correct them.")}
            </DialogDescription>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              {(warnings ?? []).map((item, index) => (
                <li key={`${item.code}-${index}`} className="rounded-control border border-line bg-paper px-3 py-2">
                  <BankWarningLine item={item} />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setWarnings(null)}>
                {tx("cancel", "Cancel")}
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void commit("HANDED_TO_BANK")}>
                {tx("confirmBankHandover", "Acknowledge and hand over to the bank")}
              </Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </section>
  );
}

function BankWarningLine({ item }: { item: PresentationDiscrepancy }) {
  const { tx } = useCopy();
  if (item.code === "PORT_MISMATCH") {
    const place = tx(item.field === "port_of_loading" ? "portOfLoading" : "portOfDischarge", item.field === "port_of_loading" ? "Port of loading" : "Port of discharge");
    return (
      <span>
        {place}: {tx("bankCheckInvoiceSide", "Invoice")} <Ltr>{item.invoiceValue.trim() || "—"}</Ltr>
        {" · "}
        {tx("bankCheckBookingSide", "Booking")} <Ltr>{item.bookingValue.trim() || "—"}</Ltr>
      </span>
    );
  }
  if (item.code === "DOCUMENT_NOT_READY") {
    return <span>{tx(item.documentKey === "bill_of_lading" ? "bankCheckDocBl" : "bankCheckDocInvoice", item.documentKey === "bill_of_lading" ? "The bill of lading is not approved or available." : "The commercial invoice is not approved or available.")}</span>;
  }
  return <span>{tx(item.field === "invoice" ? "bankCheckNoInvoice" : "bankCheckNoBooking", item.field === "invoice" ? "There is no invoice to compare with the booking." : "There is no booking to compare with the invoice.")}</span>;
}

function DirectButtons({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const { tx } = useCopy();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {["SCANNED", "INTERNAL_REVIEW", "READY_FOR_DISPATCH"].map((to) => (
        <Button key={to} data-decision={to} size="sm" variant="outline" onClick={async () => {
          try {
            await api(`/api/v1/export-cases/${caseId}/direct/status`, { method: "POST", body: JSON.stringify({ to }) });
            notifySuccess(tx("directStageSaved", "Direct route stage saved"));
            onDone();
          } catch (error) {
            notifyError(error);
          }
        }}>{tx(`status.${to}`, to)}</Button>
      ))}
    </div>
  );
}

export function CourierPanel({ caseId }: { caseId: string }) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const { key, reset: resetKey } = useIdempotencyKey();
  const submitLock = useSubmitLock();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["courier", caseId],
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    queryFn: async () => (await api<Array<Record<string, unknown>>>(`/api/v1/export-cases/${caseId}/courier`)).data,
  });
  return (
    <div className="space-y-4">
      <FormDisclosure
        open={open}
        onToggle={() => setOpen((value) => !value)}
        title={tx("addManualShipment", "Add manual shipment")}
        hint={tx("courierNotCargo", "Courier status is not customer delivery.")}
        openLabel={tx("addManualShipment", "Add manual shipment")}
        closeLabel={tx("cancel", "Cancel")}
      >
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!submitLock.acquire()) return;
          const formEl = event.currentTarget;
          const form = new FormData(formEl);
          try {
            await api(`/api/v1/export-cases/${caseId}/courier`, {
              method: "POST",
              idempotencyKey: key.current,
              body: JSON.stringify({
                sender: form.get("sender"),
                carrier: form.get("carrier"),
                trackingNumber: form.get("trackingNumber"),
                recipientSummary: form.get("recipientSummary"),
              }),
            });
            resetKey();
            formEl.reset();
            notifySuccess(tx("courierShipmentAdded", "Manual shipment added"));
            await client.invalidateQueries({ queryKey: ["courier", caseId] });
          } catch (error) {
            if (isDefinitiveFailure(error)) resetKey();
            notifyError(error);
          } finally {
            submitLock.release();
          }
        }}
      >
        <Field label={tx("sender", "Sender")}>
          <Select name="sender" defaultValue="COMPANY"><option>COMPANY</option><option>BANK</option></Select>
        </Field>
        <Field label={tx("carrier", "Carrier")}>
          <Select name="carrier" defaultValue="DHL"><option>DHL</option><option>UPS</option><option>FEDEX</option><option>ARAMEX</option><option>TNT</option></Select>
        </Field>
        <Field label={tx("trackingNumber", "Tracking number")}><Input name="trackingNumber" dir="ltr" /></Field>
        <Field label={tx("recipientSummary", "Recipient summary")}><Input name="recipientSummary" /></Field>
        <Button type="submit" disabled={submitLock.busy}>{tx("addManualShipment", "Add manual shipment")}</Button>
      </form>
      </FormDisclosure>
      {query.data?.map((s) => (
        <div key={String(s.id)} className="rounded-card border border-line bg-card p-4 text-sm shadow-card">
          <div>{String(s.carrier)} · <Ltr>{String(s.tracking_number || tx("noNumber", "no number"))}</Ltr> · <StatusBadge value={String(s.status)} /></div>
          <p className="text-ink-muted">{tx("sourceManual", "Source: MANUAL")}. {s.trackingUrl ? <a className="underline" href={String(s.trackingUrl)} target="_blank" rel="noreferrer">{tx("openCarrier", "Open carrier page")}</a> : tx("noTrackingUrl", "No allowlisted tracking URL.")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["DISPATCHED", "IN_TRANSIT", "DELIVERED"].map((status) => (
              <Button key={status} size="sm" variant="outline" onClick={async () => {
                try {
                  await api(`/api/v1/courier/${s.id}/status`, { method: "POST", body: JSON.stringify({ status, version: s.version }) });
                  notifySuccess(tx("courierStatusSaved", "Shipment status updated"));
                  await client.invalidateQueries({ queryKey: ["courier", caseId] });
                } catch (error) {
                  notifyError(error);
                }
              }} data-decision={status}>{tx(`status.${status}`, status)}</Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
