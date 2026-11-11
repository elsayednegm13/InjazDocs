import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { usePermissions } from "@/lib/permissions";
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";

export type ShippingMethod = {
  id: string;
  code: string;
  label: string;
  includes_freight: number;
  sort_order: number;
};

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
    staleTime: 5 * 60_000,
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
  const perms = usePermissions();
  const methods = useShippingMethods();
  const [open, setOpen] = useState(false);
  const selected = (methods.data ?? []).find((method) => method.code === value || method.label === value);
  const canManageShipping = perms.has("catalog.shipping.manage");
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink">{tx("shippingMethod", "طريقة الشحن")}</span>
        {canManageShipping ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:underline disabled:opacity-50"
          >
            <Settings2 className="h-3 w-3" />
            <span>{tx("tradeManageShipping", "إدارة طرق الشحن")}</span>
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          value={selected?.id ?? ""}
          disabled={disabled}
          className="h-10"
          onChange={(event) => {
            const method = (methods.data ?? []).find((item) => item.id === event.target.value);
            if (method) onChange(method.label);
          }}
        >
          <option value="">{tx("tradeCustomShipping", "مخصص")}</option>
          {(methods.data ?? []).map((method) => (
            <option key={method.id} value={method.id}>{method.label}</option>
          ))}
        </Select>
        <Input
          dir="ltr"
          className="h-10"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
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
