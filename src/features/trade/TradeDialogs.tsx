import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { moneyMinor, moneyText, type BankAccount, type InvoiceDraftLine, type ProductPreset } from "./trade-model";

export const PAYMENT_PRESETS = [
  "100% ADVANCE",
  "100% PAID",
  "30% ADVANCE, 70% AGAINST DOCUMENTS",
  "50% ADVANCE, 50% AGAINST BL COPY",
  "100% L/C AT SIGHT",
];

export function PaymentTermField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { tx } = useCopy();
  return (
    <div>
      <Field label={tx("paymentTermLabel", "Payment term text")}>
        <Input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </Field>
      <div className="mt-1 flex flex-wrap gap-1">
        {PAYMENT_PRESETS.map((preset) => (
          <button key={preset} type="button" disabled={disabled} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink" onClick={() => onChange(preset)}>
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CompanyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const identity = useQuery({
    queryKey: ["exporter-identity"],
    queryFn: async () => (await api<Record<string, string | null>>("/api/v1/settings/exporter-identity")).data,
    enabled: open,
  });
  const banks = useQuery({ queryKey: ["exporter-banks"], queryFn: async () => (await api<BankAccount[]>("/api/v1/settings/exporter-bank-accounts")).data, enabled: open });
  const [busy, setBusy] = useState(false);
  const row = identity.data;
  const bank = (banks.data ?? []).find((item) => item.is_default) ?? banks.data?.[0];

  async function save(form: FormData) {
    setBusy(true);
    try {
      await api("/api/v1/settings/exporter-identity", {
        method: "PUT",
        body: JSON.stringify({
          nameEn: form.get("nameEn"),
          nameAr: form.get("nameAr"),
          address: form.get("address"),
          taxCard: form.get("taxCard"),
          taxFile: form.get("taxFile"),
          commercialRegistry: form.get("commercialRegistry"),
          phone: form.get("phone"),
          email: form.get("email"),
        }),
      });
      const bankBody = {
        accountName: form.get("accountName"),
        iban: form.get("iban"),
        bankName: form.get("bankName"),
        bankAddress: form.get("bankAddress"),
        swiftCode: form.get("swiftCode"),
        currency: "USD",
        isDefault: true,
      };
      if (bank?.id) await api(`/api/v1/settings/exporter-bank-accounts/${bank.id}`, { method: "PATCH", body: JSON.stringify(bankBody) });
      else await api("/api/v1/settings/exporter-bank-accounts", { method: "POST", body: JSON.stringify(bankBody) });
      notifySuccess(tx("tradeIdentitySaved", "Exporter identity saved"));
      await client.invalidateQueries({ queryKey: ["exporter-identity"] });
      await client.invalidateQueries({ queryKey: ["exporter-banks"] });
      onClose();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPortal>
      <DialogOverlay className="fixed inset-0 z-40 bg-ink/40" />
      <DialogContent className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(100%-2rem,40rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card border border-line bg-card p-4 text-start shadow-card focus:outline-none">
        <DialogTitle className="text-base font-semibold text-ink">{tx("tradeCompanyDialog", "Company and bank")}</DialogTitle>
        {row && !banks.isLoading ? (
          <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget)); }}>
            <Field label={tx("tradeNameEn", "English name")}><Input name="nameEn" defaultValue={row.name_en ?? ""} /></Field>
            <Field label={tx("tradeNameAr", "Arabic name")}><Input name="nameAr" defaultValue={row.name_ar ?? ""} /></Field>
            <div className="md:col-span-2"><Field label={tx("tradeAddress", "Address")}><Textarea name="address" className="min-h-16" defaultValue={row.address ?? ""} /></Field></div>
            <Field label={tx("taxCard", "Tax card")}><Input name="taxCard" dir="ltr" defaultValue={row.tax_card ?? ""} /></Field>
            <Field label={tx("taxFile", "Tax file")}><Input name="taxFile" dir="ltr" defaultValue={row.tax_file ?? ""} /></Field>
            <Field label={tx("commercialRegistry", "Commercial registry")}><Input name="commercialRegistry" dir="ltr" defaultValue={row.commercial_registry ?? ""} /></Field>
            <Field label={tx("phone", "Phone")}><Input name="phone" dir="ltr" defaultValue={row.phone ?? ""} /></Field>
            <Field label={tx("email", "Email")}><Input name="email" dir="ltr" defaultValue={row.email ?? ""} /></Field>
            <Field label={tx("accountName", "Account name")}><Input name="accountName" defaultValue={bank?.account_name ?? ""} /></Field>
            <Field label={tx("iban", "IBAN")}><Input name="iban" dir="ltr" defaultValue={bank?.iban ?? ""} /></Field>
            <Field label={tx("bankName", "Bank name")}><Input name="bankName" defaultValue={bank?.bank_name ?? ""} /></Field>
            <Field label={tx("swift", "SWIFT code")}><Input name="swiftCode" dir="ltr" defaultValue={bank?.swift_code ?? ""} /></Field>
            <div className="md:col-span-2"><Field label={tx("bankAddress", "Bank address")}><Input name="bankAddress" defaultValue={bank?.bank_address ?? ""} /></Field></div>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={busy}>{tx("save", "Save")}</Button>
              <Button type="button" variant="outline" onClick={onClose}>{tx("cancel", "Cancel")}</Button>
            </div>
          </form>
        ) : <p className="mt-3 text-sm text-ink-muted">…</p>}
      </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function CatalogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const presets = useQuery({ queryKey: ["product-presets"], queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data, enabled: open });
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", hsCode: "", barcode: "", unit: "Piece", price: "0" });

  function editPreset(preset: ProductPreset) {
    setEditingId(preset.id);
    setDraft({
      name: preset.name,
      description: preset.description_template,
      hsCode: preset.hs_code ?? "",
      barcode: preset.barcode ?? "",
      unit: preset.unit_label ?? "Piece",
      price: moneyText(preset.default_price_minor),
    });
  }

  async function saveCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: draft.name,
        descriptionTemplate: draft.description,
        barcode: draft.barcode,
        hsCode: draft.hsCode,
        unit: draft.unit || "Piece",
        defaultPriceMinor: moneyMinor(draft.price || "0"),
      };
      if (editingId) await api(`/api/v1/product-presets/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/v1/product-presets", { method: "POST", body: JSON.stringify(body) });
      setEditingId(null);
      setDraft({ name: "", description: "", hsCode: "", barcode: "", unit: "Piece", price: "0" });
      notifySuccess(tx("tradePresetSaved", "Catalog item saved"));
      await client.invalidateQueries({ queryKey: ["product-presets"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPortal>
      <DialogOverlay className="fixed inset-0 z-40 bg-ink/40" />
      <DialogContent className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(100%-2rem,42rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card border border-line bg-card p-4 text-start shadow-card focus:outline-none">
        <DialogTitle className="text-base font-semibold text-ink">{tx("tradeManageCatalog", "Manage catalog")}</DialogTitle>
        <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-sm">
          {(presets.data ?? []).map((preset) => (
            <li key={preset.id} className="flex items-center gap-2">
              <button type="button" className="min-w-0 flex-1 rounded-control border border-line px-2 py-1 text-start" onClick={() => editPreset(preset)}>
                {preset.name} · <span dir="ltr">{preset.hs_code}</span>
              </button>
              <Button type="button" size="sm" variant="outline" onClick={() => void api(`/api/v1/product-presets/${preset.id}`, { method: "DELETE" }).then(() => { notifySuccess(tx("tradePresetDeleted", "Catalog item deleted")); return client.invalidateQueries({ queryKey: ["product-presets"] }); }).catch(notifyError)}>{tx("delete", "Delete")}</Button>
            </li>
          ))}
        </ul>
        <form className="mt-3 grid gap-2 md:grid-cols-2" onSubmit={(event) => void saveCatalog(event)}>
          <Field label={tx("name", "Name")}><Input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <Field label={tx("hsCode", "HS code")}><Input dir="ltr" value={draft.hsCode} onChange={(event) => setDraft({ ...draft, hsCode: event.target.value })} /></Field>
          <div className="md:col-span-2"><Field label={tx("tradeDescription", "Description template")}><Textarea className="min-h-16" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field></div>
          <Field label={tx("barcode", "Barcode")}><Input dir="ltr" value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></Field>
          <Field label={tx("unit", "Unit")}><Input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></Field>
          <Field label={tx("price", "Default price")}><Input dir="ltr" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></Field>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={busy}>{editingId ? tx("save", "Save") : tx("tradeAddPreset", "Add catalog item")}</Button>
            <Button type="button" variant="outline" onClick={onClose}>{tx("cancel", "Cancel")}</Button>
          </div>
        </form>
      </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export async function saveLineToCatalog(line: InvoiceDraftLine) {
  const name = line.description.split(/\n/)[0]?.trim() || "Item";
  await api("/api/v1/product-presets", {
    method: "POST",
    body: JSON.stringify({
      name,
      descriptionTemplate: line.description,
      barcode: line.barcode,
      hsCode: line.hsCode,
      unit: line.unit,
      defaultPriceMinor: moneyMinor(line.price || "0"),
    }),
  });
}
