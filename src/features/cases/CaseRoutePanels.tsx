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

export function BankPanel({ caseId, route, status, onDone }: { caseId: string; route: string; status: string; onDone: () => void }) {
  const { tx } = useCopy();
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
          <Button key={to} data-decision={to} size="sm" variant="outline" onClick={async () => {
            try {
              await api(`/api/v1/export-cases/${caseId}/bank/status`, { method: "POST", body: JSON.stringify({ to }) });
              notifySuccess(tx("bankStageSaved", "Bank stage saved"));
              onDone();
            } catch (error) {
              notifyError(error);
            }
          }}>{tx(`status.${to}`, to)}</Button>
        ))}
      </div>
    </section>
  );
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
