import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { usePermissions } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  kgText,
  moneyMinor,
  moneyText,
  safeGrams,
  type BankAccount,
  type InvoiceDraftLine,
  type PackingDraftLine,
  type ProductPreset,
} from "./trade-model";

export const PAYMENT_PRESETS = [
  "100% ADVANCE",
  "100% PAID",
  "30% ADVANCE, 70% AGAINST DOCUMENTS",
  "50% ADVANCE, 50% AGAINST BL COPY",
  "100% L/C AT SIGHT",
];

export function PaymentTermField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { tx } = useCopy();
  const listId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative grid gap-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink">{tx("paymentTermLabel", "نص شرط الدفع")}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMenuOpen((prev) => !prev)}
          className="inline-flex items-center gap-0.5 text-xs font-medium text-accent transition-colors hover:underline disabled:opacity-50"
        >
          <span>{tx("paymentPresetsShort", "اقتراحات سريعة")}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      <Input
        dir="ltr"
        list={listId}
        value={value}
        disabled={disabled}
        className="h-10"
        placeholder="100% ADVANCE"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {PAYMENT_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>
      {menuOpen && !disabled ? (
        <div
          className="absolute top-full z-30 mt-1 flex w-full flex-wrap gap-1.5 rounded-control border border-line bg-card p-2 shadow-card"
          role="listbox"
        >
          {PAYMENT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              dir="ltr"
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                value === preset
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line bg-paper/60 text-ink hover:border-accent/40 hover:bg-paper",
              )}
              onClick={() => {
                onChange(preset);
                setMenuOpen(false);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PaymentPresetStrip({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { tx } = useCopy();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-ink-muted">
        {tx("paymentPresetsHint", "شروط الدفع السريعة:")}
      </span>
      {PAYMENT_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          dir="ltr"
          disabled={disabled}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50",
            value === preset
              ? "border-accent bg-accent/15 text-accent"
              : "border-line bg-paper/60 text-ink-muted hover:border-accent/40 hover:text-ink",
          )}
          onClick={() => onChange(preset)}
        >
          {preset}
        </button>
      ))}
    </div>
  );
}

export function CompanyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tx } = useCopy();
  const perms = usePermissions();
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
  const canEditIdentity = perms.has("settings.manage");
  const canEditBank = perms.has("exporter.bank_accounts.manage");

  async function save(form: FormData) {
    setBusy(true);
    try {
      if (canEditIdentity) {
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
      }
      if (canEditBank) {
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
      }
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
              <Field label={tx("tradeNameEn", "English name")}><Input name="nameEn" disabled={!canEditIdentity} defaultValue={row.name_en ?? ""} /></Field>
              <Field label={tx("tradeNameAr", "Arabic name")}><Input name="nameAr" disabled={!canEditIdentity} defaultValue={row.name_ar ?? ""} /></Field>
              <div className="md:col-span-2"><Field label={tx("tradeAddress", "Address")}><Textarea name="address" disabled={!canEditIdentity} className="min-h-16" defaultValue={row.address ?? ""} /></Field></div>
              <Field label={tx("taxCard", "Tax card")}><Input name="taxCard" dir="ltr" disabled={!canEditIdentity} defaultValue={row.tax_card ?? ""} /></Field>
              <Field label={tx("taxFile", "Tax file")}><Input name="taxFile" dir="ltr" disabled={!canEditIdentity} defaultValue={row.tax_file ?? ""} /></Field>
              <Field label={tx("commercialRegistry", "Commercial registry")}><Input name="commercialRegistry" dir="ltr" disabled={!canEditIdentity} defaultValue={row.commercial_registry ?? ""} /></Field>
              <Field label={tx("phone", "Phone")}><Input name="phone" dir="ltr" disabled={!canEditIdentity} defaultValue={row.phone ?? ""} /></Field>
              <Field label={tx("email", "Email")}><Input name="email" dir="ltr" disabled={!canEditIdentity} defaultValue={row.email ?? ""} /></Field>
              <Field label={tx("accountName", "Account name")}><Input name="accountName" disabled={!canEditBank} defaultValue={bank?.account_name ?? ""} /></Field>
              <Field label={tx("iban", "IBAN")}><Input name="iban" dir="ltr" disabled={!canEditBank} defaultValue={bank?.iban ?? ""} /></Field>
              <Field label={tx("bankName", "Bank name")}><Input name="bankName" disabled={!canEditBank} defaultValue={bank?.bank_name ?? ""} /></Field>
              <Field label={tx("swift", "SWIFT code")}><Input name="swiftCode" dir="ltr" disabled={!canEditBank} defaultValue={bank?.swift_code ?? ""} /></Field>
              <div className="md:col-span-2"><Field label={tx("bankAddress", "Bank address")}><Input name="bankAddress" disabled={!canEditBank} defaultValue={bank?.bank_address ?? ""} /></Field></div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={busy || (!canEditIdentity && !canEditBank)}>{tx("save", "Save")}</Button>
                <Button type="button" variant="outline" onClick={onClose}>{tx("cancel", "Cancel")}</Button>
              </div>
            </form>
          ) : <p className="mt-3 text-sm text-ink-muted">…</p>}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

const EMPTY_CATALOG_DRAFT = {
  name: "",
  description: "",
  hsCode: "",
  barcode: "",
  unit: "Piece",
  price: "0",
  defaultPacking: "10",
  unitNetKg: "0.000",
  bagKg: "0.000",
  posterKg: "0.000",
  otherAccessoryKg: "0.000",
};

export function CatalogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tx } = useCopy();
  const perms = usePermissions();
  const client = useQueryClient();
  const presets = useQuery({ queryKey: ["product-presets"], queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data, enabled: open });
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_CATALOG_DRAFT);
  const canManageCatalog = perms.has("catalog.products.manage");

  function editPreset(preset: ProductPreset) {
    setEditingId(preset.id);
    const netGrams = preset.unit_net_weight_grams ?? preset.piece_weight_grams ?? 0;
    setDraft({
      name: preset.name,
      description: preset.description_template,
      hsCode: preset.hs_code ?? "",
      barcode: preset.barcode ?? "",
      unit: preset.unit_label ?? "Piece",
      price: moneyText(preset.default_price_minor),
      defaultPacking: preset.default_packing_per_package != null ? String(preset.default_packing_per_package) : "",
      unitNetKg: kgText(netGrams),
      bagKg: kgText(preset.bag_weight_grams ?? 0),
      posterKg: kgText(preset.poster_weight_grams ?? 0),
      otherAccessoryKg: kgText(preset.other_accessory_weight_grams ?? 0),
    });
  }

  async function saveCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const unitNetGrams = safeGrams(draft.unitNetKg);
      const bagGrams = safeGrams(draft.bagKg);
      const posterGrams = safeGrams(draft.posterKg);
      const otherGrams = safeGrams(draft.otherAccessoryKg);
      const packingPerPkg = draft.defaultPacking.trim() ? Number(draft.defaultPacking) : null;
      const body = {
        name: draft.name,
        descriptionTemplate: draft.description,
        barcode: draft.barcode,
        hsCode: draft.hsCode,
        unit: draft.unit || "Piece",
        defaultPriceMinor: moneyMinor(draft.price || "0"),
        defaultPackingPerPackage: Number.isInteger(packingPerPkg) && (packingPerPkg ?? 0) >= 0 ? packingPerPkg : null,
        pieceWeightGrams: unitNetGrams,
        unitNetWeightGrams: unitNetGrams,
        bagWeightGrams: bagGrams,
        posterWeightGrams: posterGrams,
        otherAccessoryWeightGrams: otherGrams,
      };
      if (editingId) await api(`/api/v1/product-presets/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/v1/product-presets", { method: "POST", body: JSON.stringify(body) });
      setEditingId(null);
      setDraft(EMPTY_CATALOG_DRAFT);
      notifySuccess(tx("tradePresetSaved", "Catalog item saved"));
      await client.invalidateQueries({ queryKey: ["product-presets"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  const unitGrossPreviewGrams =
    safeGrams(draft.unitNetKg) +
    safeGrams(draft.bagKg) +
    safeGrams(draft.posterKg) +
    safeGrams(draft.otherAccessoryKg);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/40" />
        <DialogContent className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card border border-line bg-card p-4 text-start shadow-card focus:outline-none">
          <DialogTitle className="text-base font-semibold text-ink">{tx("tradeManageCatalog", "Manage catalog & standard weights")}</DialogTitle>
          <ul className="mt-3 max-h-44 space-y-1 overflow-auto text-sm">
            {(presets.data ?? []).map((preset) => {
              const netG = preset.unit_net_weight_grams ?? preset.piece_weight_grams ?? 0;
              const bagG = preset.bag_weight_grams ?? 0;
              const posterG = preset.poster_weight_grams ?? 0;
              const otherG = preset.other_accessory_weight_grams ?? 0;
              const grossG = netG + bagG + posterG + otherG;
              return (
                <li key={preset.id} className="flex items-center gap-2">
                  <button type="button" className="min-w-0 flex-1 rounded-control border border-line px-2.5 py-1.5 text-start hover:bg-paper" onClick={() => editPreset(preset)}>
                    <span className="font-medium text-ink">{preset.name}</span>
                    <span className="ms-2 text-xs text-ink-muted" dir="ltr">
                      {preset.hs_code || "—"} · Net {kgText(netG)} kg · Bag {kgText(bagG)} kg · Poster {kgText(posterG)} kg · Gross/pc {kgText(grossG)} kg
                    </span>
                  </button>
                  {canManageCatalog ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void api(`/api/v1/product-presets/${preset.id}`, { method: "DELETE" }).then(() => { notifySuccess(tx("tradePresetDeleted", "Catalog item deleted")); return client.invalidateQueries({ queryKey: ["product-presets"] }); }).catch(notifyError)}>{tx("delete", "Delete")}</Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <form className="mt-3 grid gap-2.5 md:grid-cols-3" onSubmit={(event) => void saveCatalog(event)}>
            <div className="md:col-span-2">
              <Field label={tx("name", "Name")}><Input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
            </div>
            <Field label={tx("hsCode", "HS code")}><Input dir="ltr" value={draft.hsCode} onChange={(event) => setDraft({ ...draft, hsCode: event.target.value })} /></Field>
            <div className="md:col-span-3">
              <Field label={tx("tradeDescription", "Description template")}><Textarea className="min-h-16" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
            </div>
            <Field label={tx("barcode", "Barcode")}><Input dir="ltr" value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></Field>
            <Field label={tx("unit", "Unit")}><Input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></Field>
            <Field label={tx("price", "Default price")}><Input dir="ltr" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></Field>
            <Field label={tx("packingPerPackage", "Packing per package (pcs/bale)")}>
              <Input dir="ltr" inputMode="numeric" value={draft.defaultPacking} onChange={(event) => setDraft({ ...draft, defaultPacking: event.target.value })} />
            </Field>
            <Field label={tx("unitNetKg", "Blanket net weight / pc (kg)")}>
              <Input dir="ltr" inputMode="decimal" value={draft.unitNetKg} onChange={(event) => setDraft({ ...draft, unitNetKg: event.target.value })} />
            </Field>
            <Field label={tx("bagKg", "Bag weight / pc (kg)")}>
              <Input dir="ltr" inputMode="decimal" value={draft.bagKg} onChange={(event) => setDraft({ ...draft, bagKg: event.target.value })} />
            </Field>
            <Field label={tx("posterKg", "Poster / carton weight / pc (kg)")}>
              <Input dir="ltr" inputMode="decimal" value={draft.posterKg} onChange={(event) => setDraft({ ...draft, posterKg: event.target.value })} />
            </Field>
            <Field label={tx("otherAccessoryKg", "Other accessory weight / pc (kg)")}>
              <Input dir="ltr" inputMode="decimal" value={draft.otherAccessoryKg} onChange={(event) => setDraft({ ...draft, otherAccessoryKg: event.target.value })} />
            </Field>
            <Field label={tx("unitGrossKg", "Calculated gross / pc (kg)")}>
              <Input dir="ltr" readOnly value={kgText(unitGrossPreviewGrams)} />
            </Field>
            <div className="flex gap-2 md:col-span-3">
              {canManageCatalog ? (
                <Button type="submit" disabled={busy}>{editingId ? tx("save", "Save") : tx("tradeAddPreset", "Add catalog item")}</Button>
              ) : null}
              {editingId ? (
                <Button type="button" variant="outline" onClick={() => { setEditingId(null); setDraft(EMPTY_CATALOG_DRAFT); }}>
                  {tx("tradeNewPreset", "New item")}
                </Button>
              ) : null}
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

export async function savePackingLineToCatalog(line: PackingDraftLine) {
  const name = line.description.split(/\n/)[0]?.trim() || "Blanket Item";
  const unitNetGrams = safeGrams(line.unitNetKg);
  const bagGrams = safeGrams(line.bagKg);
  const posterGrams = safeGrams(line.posterKg);
  const otherGrams = safeGrams(line.otherAccessoryKg);
  const perPackage = Number(line.perPackage);
  await api("/api/v1/product-presets", {
    method: "POST",
    body: JSON.stringify({
      name,
      descriptionTemplate: line.description,
      barcode: line.barcode ?? "",
      hsCode: line.hsCode,
      unit: "PCS",
      defaultPackingPerPackage: Number.isInteger(perPackage) && perPackage > 0 ? perPackage : null,
      pieceWeightGrams: unitNetGrams,
      unitNetWeightGrams: unitNetGrams,
      bagWeightGrams: bagGrams,
      posterWeightGrams: posterGrams,
      otherAccessoryWeightGrams: otherGrams,
      extraAccessories: line.extraAccessories,
    }),
  });
}
