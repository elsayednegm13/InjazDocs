import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Package, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/chrome";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { moneyMinor, moneyText, type BankAccount, type ProductPreset } from "./trade-model";

type Identity = {
  name_en: string;
  name_ar: string;
  address: string;
  tax_card: string | null;
  tax_file: string | null;
  commercial_registry: string | null;
  phone: string | null;
  email: string | null;
};

type Marks = {
  logo_r2_key: string | null;
  stamp_r2_key: string | null;
  stamp_label_en: string | null;
  stamp_label_ar: string | null;
};

export function TradeSettings() {
  return (
    <div className="space-y-4">
      <IdentityCard />
      <BankCard />
      <PresetCard />
    </div>
  );
}

function IdentityCard() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ["exporter-identity"], queryFn: async () => (await api<Identity | null>("/api/v1/settings/exporter-identity")).data });
  const marks = useQuery({ queryKey: ["exporter-marks"], queryFn: async () => (await api<Marks | null>("/api/v1/settings/exporter-marks")).data });
  const [busy, setBusy] = useState(false);
  const row = identity.data;
  const mark = marks.data;
  if (identity.isLoading || marks.isLoading) {
    return <SectionCard title={tx("tradeIdentity", "Exporter identity and marks")} icon={<Stamp className="h-4 w-4" />}><p className="text-sm text-ink-muted">…</p></SectionCard>;
  }

  async function saveIdentity(form: FormData) {
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
      await api("/api/v1/settings/exporter-marks", {
        method: "PUT",
        body: JSON.stringify({
          logoR2Key: mark?.logo_r2_key,
          stampR2Key: mark?.stamp_r2_key,
          stampLabelEn: form.get("stampLabelEn"),
          stampLabelAr: form.get("stampLabelAr"),
        }),
      });
      notifySuccess(tx("tradeIdentitySaved", "Exporter identity saved"));
      await client.invalidateQueries({ queryKey: ["exporter-identity"] });
      await client.invalidateQueries({ queryKey: ["exporter-marks"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function upload(kind: "logo" | "stamp", file: File | undefined) {
    if (!file) return;
    const dataUrl = await readDataUrl(file);
    try {
      await api(`/api/v1/settings/exporter-marks/${kind}`, { method: "POST", body: JSON.stringify({ dataUrl }) });
      notifySuccess(tx(kind === "logo" ? "tradeLogoSaved" : "tradeStampSaved", kind === "logo" ? "Logo saved" : "Stamp saved"));
      await client.invalidateQueries({ queryKey: ["exporter-marks"] });
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <SectionCard title={tx("tradeIdentity", "Exporter identity and marks")} icon={<Stamp className="h-4 w-4" />}>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void saveIdentity(new FormData(event.currentTarget)); }}>
        <Field label={tx("tradeNameEn", "English name")}><Input name="nameEn" defaultValue={row?.name_en ?? ""} /></Field>
        <Field label={tx("tradeNameAr", "Arabic name")}><Input name="nameAr" defaultValue={row?.name_ar ?? ""} /></Field>
        <div className="md:col-span-2"><Field label={tx("tradeAddress", "Address")}><Textarea name="address" className="min-h-20" defaultValue={row?.address ?? ""} /></Field></div>
        <Field label={tx("taxCard", "Tax card")}><Input name="taxCard" dir="ltr" defaultValue={row?.tax_card ?? ""} /></Field>
        <Field label={tx("taxFile", "Tax file")}><Input name="taxFile" dir="ltr" defaultValue={row?.tax_file ?? ""} /></Field>
        <Field label={tx("commercialRegistry", "Commercial registry")}><Input name="commercialRegistry" dir="ltr" defaultValue={row?.commercial_registry ?? ""} /></Field>
        <Field label={tx("phone", "Phone")}><Input name="phone" dir="ltr" defaultValue={row?.phone ?? ""} /></Field>
        <Field label={tx("email", "Email")}><Input name="email" type="email" dir="ltr" defaultValue={row?.email ?? ""} /></Field>
        <Field label={tx("stampLabelEn", "Stamp text in English")}><Input name="stampLabelEn" defaultValue={mark?.stamp_label_en ?? ""} /></Field>
        <Field label={tx("stampLabelAr", "Stamp text in Arabic")}><Input name="stampLabelAr" defaultValue={mark?.stamp_label_ar ?? ""} /></Field>
        <Field label={tx("tradeLogo", "Logo")}>
          <Input type="file" accept="image/jpeg,image/png" className="py-1.5" onChange={(event) => void upload("logo", event.target.files?.[0])} />
          {mark?.logo_r2_key ? <span className="text-[11px] text-ink-muted">{tx("tradeImageReady", "Image saved")}</span> : null}
        </Field>
        <Field label={tx("tradeStamp", "Financial stamp")}>
          <Input type="file" accept="image/jpeg,image/png" className="py-1.5" onChange={(event) => void upload("stamp", event.target.files?.[0])} />
          {mark?.stamp_r2_key ? <span className="text-[11px] text-ink-muted">{tx("tradeImageReady", "Image saved")}</span> : null}
        </Field>
        <div className="md:col-span-2"><Button type="submit" disabled={busy}>{tx("save", "Save")}</Button></div>
      </form>
    </SectionCard>
  );
}

function BankCard() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const banks = useQuery({ queryKey: ["exporter-banks"], queryFn: async () => (await api<BankAccount[]>("/api/v1/settings/exporter-bank-accounts")).data });
  const [busy, setBusy] = useState(false);

  async function add(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    try {
      await api("/api/v1/settings/exporter-bank-accounts", {
        method: "POST",
        body: JSON.stringify({
          accountName: data.get("accountName"),
          iban: data.get("iban"),
          bankName: data.get("bankName"),
          bankAddress: data.get("bankAddress"),
          swiftCode: data.get("swiftCode"),
          currency: data.get("currency") || "USD",
          isDefault: data.get("isDefault") === "1",
        }),
      });
      form.reset();
      notifySuccess(tx("tradeBankSaved", "Bank account saved"));
      await client.invalidateQueries({ queryKey: ["exporter-banks"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={tx("tradeBanks", "Exporter bank accounts")} icon={<Landmark className="h-4 w-4" />}>
      <ul className="mb-3 space-y-2 text-sm">
        {(banks.data ?? []).map((bank) => (
          <li key={bank.id} className="rounded-control border border-line px-3 py-2">
            <span className="font-medium text-ink">{bank.account_name}</span>
            {bank.is_default ? <span className="ms-2 text-[11px] font-semibold text-ok">{tx("tradeDefaultBank", "Default")}</span> : null}
            <span className="mt-0.5 block text-xs text-ink-muted" dir="ltr">{bank.bank_name} · {bank.iban} · {bank.swift_code || "—"}</span>
          </li>
        ))}
      </ul>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void add(event.currentTarget); }}>
        <Field label={tx("accountName", "Account name")}><Input name="accountName" required /></Field>
        <Field label={tx("iban", "IBAN")}><Input name="iban" required dir="ltr" /></Field>
        <Field label={tx("bankName", "Bank name")}><Input name="bankName" required /></Field>
        <Field label={tx("bankAddress", "Bank address")}><Input name="bankAddress" /></Field>
        <Field label={tx("swift", "SWIFT code")}><Input name="swiftCode" dir="ltr" /></Field>
        <Field label={tx("currency", "Currency")}><Input name="currency" defaultValue="USD" dir="ltr" maxLength={3} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="isDefault" value="1" className="h-4 w-4 accent-accent" /> {tx("tradeDefaultBank", "Default")}</label>
        <div><Button type="submit" disabled={busy}>{tx("tradeAddBank", "Add bank account")}</Button></div>
      </form>
    </SectionCard>
  );
}

function PresetCard() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const presets = useQuery({ queryKey: ["product-presets"], queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data });
  const [busy, setBusy] = useState(false);

  async function add(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    try {
      await api("/api/v1/product-presets", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          descriptionTemplate: data.get("descriptionTemplate"),
          ply: data.get("ply"),
          material: data.get("material"),
          sizeLabel: data.get("sizeLabel"),
          barcode: data.get("barcode"),
          hsCode: data.get("hsCode"),
          unit: data.get("unit"),
          defaultPriceMinor: moneyMinor(String(data.get("price") || "0")),
          defaultPackingPerPackage: data.get("packing") ? Number(data.get("packing")) : null,
        }),
      });
      form.reset();
      notifySuccess(tx("tradePresetSaved", "Catalog item saved"));
      await client.invalidateQueries({ queryKey: ["product-presets"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={tx("tradePresets", "Product catalog")} icon={<Package className="h-4 w-4" />}>
      <ul className="mb-3 space-y-2 text-sm">
        {(presets.data ?? []).map((preset) => (
          <li key={preset.id} className="rounded-control border border-line px-3 py-2">
            <span className="font-medium text-ink">{preset.name}</span>
            <span className="mt-0.5 block text-xs text-ink-muted" dir="ltr">{preset.hs_code || "—"} · {preset.unit_label || "—"} · {moneyText(preset.default_price_minor)}</span>
          </li>
        ))}
      </ul>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void add(event.currentTarget); }}>
        <Field label={tx("name", "Name")}><Input name="name" required /></Field>
        <Field label={tx("unit", "Unit")}><Input name="unit" defaultValue="PCS" dir="ltr" /></Field>
        <div className="md:col-span-2"><Field label={tx("tradeDescription", "Description template")}><Textarea name="descriptionTemplate" className="min-h-20" /></Field></div>
        <Field label={tx("ply", "Ply")}><Input name="ply" dir="ltr" /></Field>
        <Field label={tx("material", "Material")}><Input name="material" /></Field>
        <Field label={tx("size", "Size")}><Input name="sizeLabel" dir="ltr" /></Field>
        <Field label={tx("barcode", "Barcode")}><Input name="barcode" dir="ltr" /></Field>
        <Field label={tx("hsCode", "HS code")}><Input name="hsCode" dir="ltr" /></Field>
        <Field label={tx("price", "Default price")}><Input name="price" dir="ltr" defaultValue="0" /></Field>
        <Field label={tx("packingPerPackage", "Default packing per package")}><Input name="packing" dir="ltr" inputMode="numeric" /></Field>
        <div><Button type="submit" disabled={busy}>{tx("tradeAddPreset", "Add catalog item")}</Button></div>
      </form>
    </SectionCard>
  );
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
