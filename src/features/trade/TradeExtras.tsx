import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";

export type ShippingMethod = {
  id: string;
  code: string;
  label: string;
  includes_freight: number;
  sort_order: number;
};

const ZONE_TOP = 841.89 - 210;
const ZONE_HEIGHT = 164;

export function includesFreight(label: string, methods: ShippingMethod[]) {
  const key = label.trim().toLowerCase();
  const found = methods.find((method) => method.code.toLowerCase() === key || method.label.toLowerCase() === key);
  if (found) return found.includes_freight === 1;
  return /cfr|c&f|cif/i.test(label);
}

export function useShippingMethods() {
  return useQuery({
    queryKey: ["shipping-methods"],
    queryFn: async () => (await api<ShippingMethod[]>("/api/v1/shipping-methods")).data,
  });
}

export function ShippingMethodField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { tx } = useCopy();
  const methods = useShippingMethods();
  const [open, setOpen] = useState(false);
  const selected = (methods.data ?? []).find((method) => method.code === value || method.label === value);
  return (
    <div>
      <Field label={tx("shippingMethod", "Shipping method")}>
        <div className="flex gap-2">
          <Select
            value={selected?.id ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const method = (methods.data ?? []).find((item) => item.id === event.target.value);
              if (method) onChange(method.label);
            }}
          >
            <option value="">{tx("tradeCustomShipping", "Custom text")}</option>
            {(methods.data ?? []).map((method) => (
              <option key={method.id} value={method.id}>{method.label}</option>
            ))}
          </Select>
          <Input dir="ltr" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        </div>
      </Field>
      <Button type="button" size="sm" variant="outline" className="mt-1" disabled={disabled} onClick={() => setOpen(true)}>
        {tx("tradeManageShipping", "Manage shipping methods")}
      </Button>
      <ShippingMethodsDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function ShippingMethodsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const methods = useShippingMethods();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ShippingMethod | null>(null);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [freight, setFreight] = useState(false);

  function edit(method: ShippingMethod) {
    setEditing(method);
    setCode(method.code);
    setLabel(method.label);
    setFreight(method.includes_freight === 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = { code, label: label || code, includesFreight: freight, sortOrder: editing?.sort_order ?? (methods.data?.length ?? 0) + 1 };
      if (editing) await api(`/api/v1/shipping-methods/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/v1/shipping-methods", { method: "POST", body: JSON.stringify(body) });
      setEditing(null);
      setCode("");
      setLabel("");
      setFreight(false);
      notifySuccess(tx("tradeShippingSaved", "Shipping method saved"));
      await client.invalidateQueries({ queryKey: ["shipping-methods"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/v1/shipping-methods/${id}`, { method: "DELETE" });
      if (editing?.id === id) setEditing(null);
      notifySuccess(tx("tradeShippingDeleted", "Shipping method deleted"));
      await client.invalidateQueries({ queryKey: ["shipping-methods"] });
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/40" />
        <DialogContent className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card border border-line bg-card p-4 text-start shadow-card focus:outline-none">
          <DialogTitle className="text-base font-semibold text-ink">{tx("tradeManageShipping", "Manage shipping methods")}</DialogTitle>
          <ul className="mt-3 space-y-1 text-sm">
            {(methods.data ?? []).map((method) => (
              <li key={method.id} className="flex items-center justify-between gap-2 rounded-control border border-line px-2 py-1">
                <button type="button" className="text-start" onClick={() => edit(method)}>
                  <span className="font-medium text-ink" dir="ltr">{method.label}</span>
                  <span className="ms-2 text-xs text-ink-muted">{method.includes_freight ? tx("tradeFreightAdded", "Freight added") : tx("tradeFreightExcluded", "Freight not added")}</span>
                </button>
                <Button type="button" size="sm" variant="outline" onClick={() => void remove(method.id)}>{tx("delete", "Delete")}</Button>
              </li>
            ))}
          </ul>
          <form className="mt-3 grid gap-2" onSubmit={(event) => void save(event)}>
            <Field label={tx("tradeShippingCode", "Printed code")}><Input dir="ltr" required value={code} onChange={(event) => setCode(event.target.value)} /></Field>
            <Field label={tx("tradeShippingLabel", "Label")}><Input dir="ltr" value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={freight} onChange={(event) => setFreight(event.target.checked)} />
              {tx("tradeIncludesFreight", "Add sea freight to the invoice total")}
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{editing ? tx("save", "Save") : tx("tradeAddShipping", "Add shipping method")}</Button>
              <Button type="button" variant="outline" onClick={onClose}>{tx("cancel", "Cancel")}</Button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function useStampPreview() {
  return useQuery({
    queryKey: ["stamp-preview"],
    queryFn: async () => {
      const response = await fetch("/api/v1/settings/exporter-marks/file/stamp", { credentials: "include" });
      if (response.status === 404) return "";
      if (!response.ok) throw new Error("stamp");
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    },
  });
}

export async function stampPngDataUrl(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("canvas");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function StampPad({
  stamped,
  x,
  y,
  rotation,
  disabled,
  onChange,
}: {
  stamped: boolean;
  x: number;
  y: number;
  rotation: number;
  disabled?: boolean;
  onChange: (next: { stamped: boolean; x: number; y: number; rotation: number }) => void;
}) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const preview = useStampPreview();
  const [hit, setHit] = useState(0);
  const left = `${(x / 595.28) * 100}%`;
  const bottom = `${((y - ZONE_TOP) / ZONE_HEIGHT) * 100}%`;

  async function replaceImage(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await stampPngDataUrl(file);
      await api("/api/v1/settings/exporter-marks/stamp", { method: "POST", body: JSON.stringify({ dataUrl }) });
      notifySuccess(tx("tradeStampSaved", "Stamp saved"));
      await client.invalidateQueries({ queryKey: ["stamp-preview"] });
      await client.invalidateQueries({ queryKey: ["exporter-marks"] });
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{tx("tradeStampPad", "Stamp area")}</p>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center">
            <input className="sr-only" type="file" accept="image/png,image/jpeg" disabled={disabled} onChange={(event) => void replaceImage(event.target.files?.[0])} />
            <span className="rounded-control border border-line px-2 py-1 text-xs text-ink">{tx("tradeReplaceStamp", "Change stamp image")}</span>
          </label>
          <Button type="button" size="sm" variant="outline" disabled={disabled || !stamped} onClick={() => onChange({ stamped: false, x, y, rotation })}>
            {tx("tradeClearStamp", "Remove stamp")}
          </Button>
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        className="relative block w-full overflow-hidden rounded-card border border-dashed border-line bg-paper text-start disabled:opacity-60"
        style={{ aspectRatio: `595 / ${ZONE_HEIGHT}` }}
        onClick={(event) => {
          if (!preview.data) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const nx = (event.clientX - rect.left) / rect.width;
          const ny = (event.clientY - rect.top) / rect.height;
          onChange({
            stamped: true,
            x: Math.min(575, Math.max(20, nx * 595.28)),
            y: Math.min(ZONE_TOP + ZONE_HEIGHT - 8, Math.max(ZONE_TOP + 8, ZONE_TOP + (1 - ny) * ZONE_HEIGHT)),
            rotation: -7 + Math.random() * 8,
          });
          setHit((value) => value + 1);
        }}
      >
        <span className="pointer-events-none absolute inset-x-3 top-2 text-[11px] text-ink-muted">{tx("tradeStampHint", "Click where the stamp should land")}</span>
        {stamped && preview.data ? (
          <img
            key={hit}
            alt=""
            src={preview.data}
            className="pointer-events-none absolute w-[18%] max-w-[140px] origin-center"
            style={{
              left,
              bottom,
              transform: `translate(-50%, 50%) rotate(${rotation}deg)`,
              animation: "exportflow-stamp-hit 520ms cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          />
        ) : null}
      </button>
      {!preview.data ? <p className="text-xs text-ink-muted">{tx("tradeStampMissing", "Upload a transparent PNG stamp before placing it.")}</p> : null}
      <style>{`@keyframes exportflow-stamp-hit { 0% { transform: translate(-50%, calc(50% - 34px)) scale(1.45); opacity: 0.15; filter: blur(1px); } 58% { transform: translate(-50%, 54%) scale(0.9); opacity: 1; filter: none; } 78% { transform: translate(-50%, 46%) scale(1.05); } 100% { transform: translate(-50%, 50%) scale(1); } }`}</style>
    </div>
  );
}
