import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { tradePdfFilename } from "@shared/trade-sheet";
import {
  groupPackingByContainer,
  parseExtraAccessories,
  shouldIncludePiecesInReconciliation,
  type PackingLineType,
} from "@shared/trade-documents";
import { cn } from "@/lib/utils";
import {
  applyDraftWeightPatch,
  computeDraftPackingWeights,
  downloadPdf,
  kgText,
  lineAmount,
  liveReconciliation,
  moneyMinor,
  moneyText,
  newKey,
  safeGrams,
  type BankAccount,
  type ExtraAccessory,
  type InvoiceDraftLine,
  type PackingDraftLine,
  type ProductPreset,
} from "./trade-model";
import { CatalogDialog, CompanyDialog, PaymentTermField, saveLineToCatalog, savePackingLineToCatalog } from "./TradeDialogs";
import { includesFreight, ShippingMethodField, useShippingMethods } from "./TradeExtras";
import { LiveInvoiceView, stampFromRow, type LiveSheetModel } from "./LiveSheet";
import { defaultPrintFields, parsePrintFields, resolvePrintRows, type CustomerPrintProfile } from "@shared/trade-print-fields";
import { PrintFieldsPanel, useCustomerPrintProfile } from "./PrintFields";
import { EmbeddedProformaTab, type CaseProformaRow } from "./EmbeddedProformaTab";

type SheetLine = {
  description: string;
  hs_code: string | null;
  barcode: string | null;
  unit_label: string | null;
  quantity: number;
  unit_price_minor: number;
};

type SheetPack = {
  container_id: string | null;
  line_type?: PackingLineType | null;
  description: string;
  hs_code: string | null;
  barcode?: string | null;
  packages_count: number;
  packing_per_package: number;
  unit_net_weight_grams?: number | null;
  bag_weight_grams?: number | null;
  poster_weight_grams?: number | null;
  other_accessory_weight_grams?: number | null;
  extra_accessories_json?: string | null;
  manual_weight_override?: number | null;
  include_pieces_in_reconciliation?: number | null;
  gross_weight_grams: number;
  net_weight_grams: number;
};

type SheetContainer = {
  id: string;
  booking_id?: string;
  slot_index?: number;
  official_number?: string | null;
  status?: string;
  version?: number;
};

type SheetBooking = {
  id: string;
  booking_number: string;
  expected_containers: number;
  status: string;
  version: number;
};

type Sheet = {
  header: {
    case_id?: string;
    trade_status: string;
    payment_term_label: string | null;
    shipping_method_label: string | null;
    origin_of_goods: string | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    exporter_bank_account_id: string | null;
    invoiced_freight_minor: number;
    packages_count: number;
    gross_weight_grams: number;
    net_weight_grams: number;
    currency: string;
    print_reference: string | null;
    is_stamped: number;
    stamp_x: number | null;
    stamp_y: number | null;
    stamp_rotation: number | null;
    stamp_x_ratio: number | null;
    stamp_y_ratio: number | null;
    stamp_scale: number | null;
    packing_is_stamped: number;
    packing_stamp_x_ratio: number | null;
    packing_stamp_y_ratio: number | null;
    packing_stamp_scale: number | null;
    packing_stamp_rotation: number | null;
    print_fields_json: string | null;
  };
  lines: SheetLine[];
  packing: SheetPack[];
  containers?: SheetContainer[];
  bookings?: SheetBooking[];
  proformas?: CaseProformaRow[];
};

export type TradeWorkspaceTab = "proforma" | "invoice" | "packing" | "preview";
export type LivePreviewDocKind = "proforma" | "commercial" | "packing" | "customs";

export function TradeBuilder({
  invoiceId,
  caseId = "",
  currency,
  containers,
  bookings = [],
  canEdit,
  customerCode = "",
  customerId = "",
  invoiceDate = "",
  customerName = "",
  customerCountry = "",
  invoiceNumber = "",
}: {
  invoiceId: string;
  caseId?: string;
  currency: string;
  containers: SheetContainer[];
  bookings?: Array<{ id: string; booking_number?: string; status?: string; version?: number }>;
  canEdit: boolean;
  customerCode?: string;
  customerId?: string;
  invoiceDate?: string;
  customerName?: string;
  customerCountry?: string;
  invoiceNumber?: string;
}) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const sheet = useQuery({
    queryKey: ["trade-sheet", invoiceId],
    queryFn: async () => (await api<Sheet>(`/api/v1/invoices/${invoiceId}/trade-sheet`)).data,
  });
  const banks = useQuery({ queryKey: ["exporter-banks"], queryFn: async () => (await api<BankAccount[]>("/api/v1/settings/exporter-bank-accounts")).data });
  const presets = useQuery({ queryKey: ["product-presets"], queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data });
  const identity = useQuery({ queryKey: ["exporter-identity"], queryFn: async () => (await api<Record<string, string | null> | null>("/api/v1/settings/exporter-identity")).data });

  const [section, setSection] = useState<TradeWorkspaceTab>("invoice");
  const [lines, setLines] = useState<InvoiceDraftLine[]>([]);
  const [packing, setPacking] = useState<PackingDraftLine[]>([]);
  const [paymentLabel, setPaymentLabel] = useState("");
  const [reference, setReference] = useState("");
  const [stamp, setStamp] = useState(stampFromRow(null));
  const [packingStamp, setPackingStamp] = useState(stampFromRow(null));
  const [printFields, setPrintFields] = useState(defaultPrintFields());
  const [liveDoc, setLiveDoc] = useState<LivePreviewDocKind>("commercial");
  const printProfile = useCustomerPrintProfile(customerId);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [shippingLabel, setShippingLabel] = useState("CFR");
  const [origin, setOrigin] = useState("EGYPT");
  const [portLoading, setPortLoading] = useState("");
  const [portDischarge, setPortDischarge] = useState("");
  const [bankId, setBankId] = useState("");
  const [freight, setFreight] = useState("0.00");
  const [packages, setPackages] = useState(0);
  const [gross, setGross] = useState(0);
  const [net, setNet] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newContainerNumber, setNewContainerNumber] = useState("");
  const [containerNumberEdits, setContainerNumberEdits] = useState<Record<string, string>>({});

  const issued = sheet.data?.header.trade_status === "ISSUED";
  const locked = issued || !canEdit;
  const effectiveCaseId = caseId || sheet.data?.header.case_id || "";

  const liveContainers = useMemo(() => {
    const raw = (sheet.data?.containers?.length ? sheet.data.containers : containers).filter(
      (item) => item.status !== "CANCELLED",
    );
    return raw.sort((a, b) => (Number(a.slot_index) || 0) - (Number(b.slot_index) || 0));
  }, [sheet.data?.containers, containers]);

  const liveBookings = useMemo(() => {
    const raw = sheet.data?.bookings?.length ? sheet.data.bookings : bookings;
    return raw.filter((item) => item.status !== "CANCELLED");
  }, [sheet.data?.bookings, bookings]);

  useEffect(() => {
    const data = sheet.data;
    if (!data || ready) return;
    const defaultContainerId = (data.containers ?? containers).find((c) => c.status !== "CANCELLED")?.id ?? "";
    setLines(data.lines.length ? data.lines.map(toInvoiceLine) : [blankInvoiceLine()]);
    setPacking(data.packing.length ? data.packing.map(toPackingLine) : [blankPackingLine(defaultContainerId)]);
    setPaymentLabel(data.header.payment_term_label ?? "");
    setReference(data.header.print_reference || customerCode);
    setStamp(stampFromRow(data.header));
    setPackingStamp(
      stampFromRow({
        is_stamped: data.header.packing_is_stamped,
        stamp_x_ratio: data.header.packing_stamp_x_ratio,
        stamp_y_ratio: data.header.packing_stamp_y_ratio,
        stamp_scale: data.header.packing_stamp_scale,
        stamp_rotation: data.header.packing_stamp_rotation,
      }),
    );
    setPrintFields(parsePrintFields(data.header.print_fields_json) ?? defaultPrintFields());
    setShippingLabel(data.header.shipping_method_label ?? "CFR");
    setOrigin(data.header.origin_of_goods ?? "EGYPT");
    setPortLoading(data.header.port_of_loading ?? "");
    setPortDischarge(data.header.port_of_discharge ?? "");
    setBankId(data.header.exporter_bank_account_id ?? "");
    setFreight(moneyText(Number(data.header.invoiced_freight_minor ?? 0), currency));
    setPackages(Number(data.header.packages_count ?? 0));
    setGross(Number(data.header.gross_weight_grams ?? 0));
    setNet(Number(data.header.net_weight_grams ?? 0));
    setReady(true);
  }, [sheet.data, ready, currency, customerCode, containers]);

  const summary = useMemo(
    () => liveReconciliation({ lines, packing, packages, grossGrams: gross, netGrams: net, currency }),
    [lines, packing, packages, gross, net, currency],
  );

  const groupedContainers = useMemo(() => {
    return groupPackingByContainer(
      liveContainers.map((c) => ({
        id: c.id,
        slotIndex: c.slot_index ?? null,
        officialNumber: c.official_number ?? null,
        status: c.status ?? null,
      })),
      packing.map((line) => {
        const calc = computeDraftPackingWeights(line);
        return {
          draft: line,
          calc,
          containerId: line.containerId || null,
          lineType: line.lineType,
          packagesCount: Number(line.packages) || 0,
          packingPerPackage: Number(line.perPackage) || 0,
          piecesCount: calc.piecesCount,
          grossWeightGrams: calc.grossWeightGrams,
          netWeightGrams: calc.netWeightGrams,
          includePiecesInReconciliation: line.includePiecesInReconciliation,
        };
      }),
    );
  }, [liveContainers, packing]);

  const fob = lines.reduce((sum, line) => sum + lineAmount(line, currency), 0);
  let freightMinor = 0;
  try {
    freightMinor = moneyMinor(freight, currency);
  } catch {
    freightMinor = 0;
  }
  const methods = useShippingMethods();
  const chargesFreight = includesFreight(shippingLabel, methods.data ?? []);

  async function saveDraft() {
    setBusy(true);
    try {
      await api(`/api/v1/invoices/${invoiceId}/trade-header`, {
        method: "PUT",
        body: JSON.stringify({
          paymentTermLabel: paymentLabel,
          shippingMethodLabel: shippingLabel,
          originOfGoods: origin,
          portOfLoading: portLoading,
          portOfDischarge: portDischarge,
          exporterBankAccountId: bankId || null,
          seaFreightMinor: freightMinor,
          printReference: reference,
          isStamped: stamp.stamped,
          stampXRatio: stamp.xRatio,
          stampYRatio: stamp.yRatio,
          stampScale: stamp.scale,
          stampRotation: stamp.rotation,
          packingIsStamped: packingStamp.stamped,
          packingStampXRatio: packingStamp.xRatio,
          packingStampYRatio: packingStamp.yRatio,
          packingStampScale: packingStamp.scale,
          packingStampRotation: packingStamp.rotation,
          printFields,
        }),
      });
      await api(`/api/v1/invoices/${invoiceId}/lines`, {
        method: "PUT",
        body: JSON.stringify({ lines: lines.map(serializeInvoice) }),
      });
      const saved = await api<{ reconciliation: typeof summary }>(`/api/v1/invoices/${invoiceId}/packing-lines`, {
        method: "PUT",
        body: JSON.stringify({ lines: packing.map(serializePacking) }),
      });
      notifySuccess(
        saved.data.reconciliation.matched
          ? tx("tradeDraftSaved", "تم حفظ المسودة والمجاميع متطابقة")
          : tx("tradeDraftDiffers", "تم حفظ المسودة. لا تزال هناك فروق في المطابقة."),
      );
      await client.invalidateQueries({ queryKey: ["trade-sheet", invoiceId] });
      await client.invalidateQueries({ queryKey: ["case"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      await api(`/api/v1/invoices/${invoiceId}/packing-lines`, {
        method: "PUT",
        body: JSON.stringify({ lines: packing.map(serializePacking) }),
      });
      const next = await api<typeof summary>(`/api/v1/invoices/${invoiceId}/sync-totals`, {
        method: "POST",
        body: "{}",
      });
      setPackages(next.data.invoice.packages);
      setGross(next.data.invoice.grossGrams);
      setNet(next.data.invoice.netGrams);
      notifySuccess(tx("tradeSynced", "تمت مزامنة ملخص الطرود والأوزان من الباكنج ليست إلى الفاتورة"));
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    try {
      await saveQuiet();
      await api(`/api/v1/invoices/${invoiceId}/issue-trade`, { method: "POST", body: "{}" });
      notifySuccess(tx("tradeIssued", "تم إصدار الفاتورة التجارية وبيان العبوة وإرفاقهما بالعملية"));
      setReady(false);
      await client.invalidateQueries({ queryKey: ["trade-sheet", invoiceId] });
      await client.invalidateQueries({ queryKey: ["case"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveQuiet() {
    await api(`/api/v1/invoices/${invoiceId}/trade-header`, {
      method: "PUT",
      body: JSON.stringify({
        paymentTermLabel: paymentLabel,
        shippingMethodLabel: shippingLabel,
        originOfGoods: origin,
        portOfLoading: portLoading,
        portOfDischarge: portDischarge,
        exporterBankAccountId: bankId || null,
        seaFreightMinor: freightMinor,
        printReference: reference,
        isStamped: stamp.stamped,
        stampXRatio: stamp.xRatio,
        stampYRatio: stamp.yRatio,
        stampScale: stamp.scale,
        stampRotation: stamp.rotation,
        packingIsStamped: packingStamp.stamped,
        packingStampXRatio: packingStamp.xRatio,
        packingStampYRatio: packingStamp.yRatio,
        packingStampScale: packingStamp.scale,
        packingStampRotation: packingStamp.rotation,
        printFields,
      }),
    });
    await api(`/api/v1/invoices/${invoiceId}/lines`, {
      method: "PUT",
      body: JSON.stringify({ lines: lines.map(serializeInvoice) }),
    });
    await api(`/api/v1/invoices/${invoiceId}/packing-lines`, {
      method: "PUT",
      body: JSON.stringify({ lines: packing.map(serializePacking) }),
    });
  }

  async function addContainerToOperation() {
    if (!effectiveCaseId) return;
    setBusy(true);
    try {
      const booking = liveBookings[0];
      if (booking) {
        await api(`/api/v1/bookings/${booking.id}/slots`, {
          method: "POST",
          body: JSON.stringify({ count: 1 }),
        });
      } else {
        await api("/api/v1/bookings", {
          method: "POST",
          body: JSON.stringify({
            caseId: effectiveCaseId,
            bookingNumber: `BKG-${invoiceNumber || Date.now().toString().slice(-6)}`,
            expectedContainers: 1,
          }),
        });
      }
      const refreshed = await api<Sheet>(`/api/v1/invoices/${invoiceId}/trade-sheet`);
      const newestContainer = (refreshed.data.containers ?? []).at(-1);
      if (newestContainer && newContainerNumber.trim()) {
        await api(`/api/v1/containers/${newestContainer.id}/number`, {
          method: "POST",
          body: JSON.stringify({
            officialNumber: newContainerNumber.trim().toUpperCase(),
            override: true,
            version: newestContainer.version ?? 1,
          }),
        });
        setNewContainerNumber("");
      }
      await client.invalidateQueries({ queryKey: ["trade-sheet", invoiceId] });
      await client.invalidateQueries({ queryKey: ["case", effectiveCaseId] });
      notifySuccess(tx("containerAdded", "تمت إضافة حاوية جديدة للعملية"));
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveContainerNumber(container: SheetContainer) {
    const raw = (containerNumberEdits[container.id] ?? container.official_number ?? "").trim().toUpperCase();
    if (!raw) return;
    setBusy(true);
    try {
      await api(`/api/v1/containers/${container.id}/number`, {
        method: "POST",
        body: JSON.stringify({
          officialNumber: raw,
          override: true,
          version: container.version ?? 1,
        }),
      });
      await client.invalidateQueries({ queryKey: ["trade-sheet", invoiceId] });
      if (effectiveCaseId) await client.invalidateQueries({ queryKey: ["case", effectiveCaseId] });
      notifySuccess(tx("containerNumberSaved", "تم حفظ رقم الحاوية الرسمي"));
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  function insertPresetToInvoice(id: string) {
    const preset = (presets.data ?? []).find((item) => item.id === id);
    if (!preset) return;
    setLines((current) => [
      ...current.filter((item) => item.description.trim()),
      {
        key: newKey(),
        description: [preset.description_template, preset.ply, preset.material, preset.size_label].filter(Boolean).join("\n"),
        hsCode: preset.hs_code ?? "",
        barcode: preset.barcode ?? "",
        unit: preset.unit_label ?? "PCS",
        quantity: "1",
        price: moneyText(preset.default_price_minor, currency),
      },
    ]);
  }

  function insertPresetToPackingContainer(presetId: string, containerId: string) {
    const preset = (presets.data ?? []).find((item) => item.id === presetId);
    if (!preset) return;
    const netGrams = preset.unit_net_weight_grams ?? preset.piece_weight_grams ?? 0;
    const bagGrams = preset.bag_weight_grams ?? 0;
    const posterGrams = preset.poster_weight_grams ?? 0;
    const otherGrams = preset.other_accessory_weight_grams ?? 0;
    const extraAccessories = parseExtraAccessories(preset.extra_accessories_json);
    const defaultPerPkg = preset.default_packing_per_package && preset.default_packing_per_package > 0 ? String(preset.default_packing_per_package) : "10";
    const created = applyDraftWeightPatch(
      {
        key: newKey(),
        containerId,
        lineType: "PRODUCT",
        description: [preset.description_template, preset.ply, preset.material, preset.size_label].filter(Boolean).join("\n"),
        hsCode: preset.hs_code ?? "",
        barcode: preset.barcode ?? "",
        packages: "1",
        perPackage: defaultPerPkg,
        unitNetKg: kgText(netGrams),
        bagKg: kgText(bagGrams),
        posterKg: kgText(posterGrams),
        otherAccessoryKg: kgText(otherGrams),
        extraAccessories,
        manualOverride: false,
        includePiecesInReconciliation: true,
        grossKg: "0.000",
        netKg: "0.000",
      },
      {},
    );
    setPacking((current) => [...current.filter((item) => item.description.trim() || item.containerId !== containerId), created]);
  }

  function copyInvoiceLinesToContainer(targetContainerId: string) {
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) return;
    const catalog = presets.data ?? [];
    const drafted = validLines.map((line) => {
      const matchedPreset = catalog.find(
        (preset) =>
          (preset.hs_code && preset.hs_code === line.hsCode && line.description.includes(preset.name)) ||
          line.description.toLowerCase().includes(preset.name.toLowerCase()),
      );
      const netGrams = matchedPreset?.unit_net_weight_grams ?? matchedPreset?.piece_weight_grams ?? 0;
      const bagGrams = matchedPreset?.bag_weight_grams ?? 0;
      const posterGrams = matchedPreset?.poster_weight_grams ?? 0;
      const otherGrams = matchedPreset?.other_accessory_weight_grams ?? 0;
      const extraAccessories = parseExtraAccessories(matchedPreset?.extra_accessories_json);
      const perPkg = matchedPreset?.default_packing_per_package && matchedPreset.default_packing_per_package > 0
        ? matchedPreset.default_packing_per_package
        : Number(line.quantity) || 1;
      const qty = Number(line.quantity) || 1;
      const packagesCount = perPkg > 0 && qty % perPkg === 0 ? Math.max(1, qty / perPkg) : 1;
      const effectivePerPkg = packagesCount > 0 && qty % packagesCount === 0 ? qty / packagesCount : qty;
      return applyDraftWeightPatch(
        {
          key: newKey(),
          containerId: targetContainerId,
          lineType: "PRODUCT",
          description: line.description,
          hsCode: line.hsCode,
          barcode: line.barcode,
          packages: String(packagesCount),
          perPackage: String(effectivePerPkg),
          unitNetKg: kgText(netGrams),
          bagKg: kgText(bagGrams),
          posterKg: kgText(posterGrams),
          otherAccessoryKg: kgText(otherGrams),
          extraAccessories,
          manualOverride: false,
          includePiecesInReconciliation: true,
          grossKg: "0.000",
          netKg: "0.000",
        },
        {},
      );
    });
    setPacking((current) => {
      const nonBlank = current.filter((item) => item.description.trim());
      return [...nonBlank, ...drafted];
    });
  }

  function updatePackingLine(key: string, patch: Partial<PackingDraftLine>) {
    setPacking((current) => current.map((item) => (item.key === key ? applyDraftWeightPatch(item, patch) : item)));
  }

  function buildSheetModel(kind: "proforma" | "commercial" | "packing"): LiveSheetModel {
    const profile: CustomerPrintProfile = printProfile.data ?? {
      name: "",
      address: "",
      taxId: "",
      phone: "",
      email: "",
      bankName: "",
      accountName: "",
      accountLast4: "",
      ibanLast4: "",
      swift: "",
      code: "",
      country: "",
    };
    const printed = resolvePrintRows(printFields, profile, {
      date: invoiceDate,
      invoiceNumber: invoiceNumber || invoiceId,
      reference,
    });
    const company = identity.data;
    const bank = (banks.data ?? []).find((item) => item.id === bankId);
    const identityBlock = {
      nameEn: company?.name_en ?? "",
      nameAr: company?.name_ar ?? "",
      address: company?.address ?? "",
      phone: company?.phone ?? "",
      email: company?.email ?? "",
      taxCard: company?.tax_card ?? "",
      taxFile: company?.tax_file ?? "",
      commercialRegistry: company?.commercial_registry ?? "",
    };
    const facts = [
      { label: "ORIGIN OF GOODS", value: origin },
      { label: "PORT OF LOADING", value: portLoading },
      { label: "PORT OF DISCHARGE", value: portDischarge },
      { label: "SHIPPING METHOD", value: shippingLabel },
      { label: "PAYMENT TERM", value: paymentLabel },
    ];
    const bankRows = bank
      ? [
          { label: "ACCOUNT NAME", value: bank.account_name },
          { label: "IBAN", value: bank.iban },
          { label: "BANK NAME", value: bank.bank_name },
          { label: "BANK ADDRESS", value: bank.bank_address ?? "" },
          { label: "SWIFT CODE", value: bank.swift_code ?? "" },
        ]
      : [];
    if (kind === "packing") {
      return {
        title: "PACKING LIST",
        draft: !issued,
        identity: identityBlock,
        meta: printed.meta.length ? printed.meta : [{ label: "DATE", value: "" }, { label: "INVOICE NO#", value: invoiceNumber || invoiceId }],
        buyer: printed.buyer.length ? printed.buyer : [{ label: "BILL TO", value: profile.name }, { label: "ADDRESS", value: profile.address }, { label: "Registration number", value: profile.taxId }],
        columns: ["NO", "CONTAINER", "ITEM", "PKG", "PER", "PCS", "GROSS", "NET"],
        lines: packing.map((line, index) => {
          const calc = computeDraftPackingWeights(line);
          const containerObj = liveContainers.find((c) => c.id === line.containerId);
          const containerLabel = containerObj
            ? `${containerObj.slot_index ?? ""} ${containerObj.official_number ?? ""}`.trim()
            : line.containerId || "—";
          return {
            cells: [
              String(index + 1),
              containerLabel || "—",
              line.description || "—",
              line.packages,
              line.perPackage,
              String(calc.piecesCount),
              kgText(calc.grossWeightGrams),
              kgText(calc.netWeightGrams),
            ],
          };
        }),
        totals: [
          {
            label: "TOTAL PACKING",
            value: `${summary.packing.packages} PKG / ${summary.packing.pieces} PCS / G.W ${kgText(summary.packing.grossGrams)} KG / N.W ${kgText(summary.packing.netGrams)} KG`,
          },
        ],
        facts,
        bank: [],
        clientCode: reference || customerCode,
      };
    }
    return {
      title: kind === "proforma" ? "PROFORMA INVOICE" : "COMMERCIAL INVOICE",
      draft: !issued,
      identity: identityBlock,
      meta: printed.meta.length ? printed.meta : [{ label: "DATE", value: "" }, { label: "INVOICE NO#", value: invoiceNumber || invoiceId }],
      buyer: printed.buyer.length ? printed.buyer : [{ label: "BILL TO", value: profile.name }, { label: "ADDRESS", value: profile.address }, { label: "Registration number", value: profile.taxId }],
      columns: ["NO", "DESCRIPTION", "UNIT", "QTY", "PRICE", "AMOUNT"],
      lines: lines.map((line, index) => ({
        cells: [
          String(index + 1),
          line.description || "—",
          line.unit,
          line.quantity,
          line.price,
          moneyText(lineAmount(line, currency), currency),
        ],
      })),
      totals: [
        { label: "TOTAL F.O.B", value: moneyText(fob, currency) },
        ...(chargesFreight
          ? [
              { label: "SEA FREIGHT", value: moneyText(freightMinor, currency) },
              { label: `TOTAL ${shippingLabel}`, value: moneyText(fob + freightMinor, currency) },
            ]
          : []),
      ],
      facts,
      bank: bankRows,
      clientCode: reference || customerCode,
    };
  }

  return (
    <section className="space-y-4 rounded-card border border-line bg-card p-3.5 shadow-card" data-trade-workspace="unified">
      {/* 1. Live Customs Reconciliation Bar */}
      <ReconciliationBar
        summary={summary}
        locked={locked}
        busy={busy}
        onSync={() => void sync()}
      />

      {/* 2. Unified 4-Tab Trade Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={tx("tradeWorkspaceTabs", "تبويبات المستندات التجارية")}>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={section === "proforma"}
            variant={section === "proforma" ? "default" : "outline"}
            onClick={() => setSection("proforma")}
          >
            1. {tx("tabProformaInvoice", "الفاتورة المبدئية (Proforma Invoice)")}
          </Button>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={section === "invoice"}
            variant={section === "invoice" ? "default" : "outline"}
            onClick={() => setSection("invoice")}
          >
            2. {tx("tabCommercialInvoice", "الفاتورة التجارية النهائية (Commercial Invoice)")}
          </Button>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={section === "packing"}
            variant={section === "packing" ? "default" : "outline"}
            onClick={() => setSection("packing")}
          >
            3. {tx("tabPackingAndContainers", "بيان العبوة وتحميل الحاويات (Packing List & Containers)")}
          </Button>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={section === "preview"}
            variant={section === "preview" ? "default" : "outline"}
            onClick={() => setSection("preview")}
          >
            4. {tx("tabLivePreviewAndStamp", "المعاينة الحية والختم (Live A4 Preview & Stamp)")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => setCatalogOpen(true)}>
            {tx("tradeManageCatalog", "كتالوج الأصناف والأوزان")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCompanyOpen(true)}>
            {tx("tradeCompanyDialog", "بيانات الشركة والبنك")}
          </Button>
        </div>
      </div>

      {/* TAB 1: PROFORMA INVOICE */}
      {section === "proforma" ? (
        <EmbeddedProformaTab
          caseId={effectiveCaseId}
          customerId={customerId}
          customerName={customerName}
          customerCode={customerCode}
          customerCountry={customerCountry}
          currency={currency}
          canEdit={!locked}
          defaultInvoiceNumber={invoiceNumber}
          onOpenCatalog={() => setCatalogOpen(true)}
          onConverted={() => {
            setReady(false);
            setSection("invoice");
          }}
        />
      ) : null}

      {/* TAB 2: COMMERCIAL INVOICE */}
      {section === "invoice" ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label={tx("tradeBank", "حساب البنك المصدر")}>
              <Select value={bankId} disabled={locked} onChange={(event) => setBankId(event.target.value)}>
                <option value="">{tx("tradeNoBank", "بدون حساب بنكي")}</option>
                {(banks.data ?? []).map((bank) => (
                  <option key={bank.id} value={bank.id}>{bank.account_name}</option>
                ))}
              </Select>
            </Field>
            <Field label={tx("printReference", "المرجع المطبوع (كود العميل)")}>
              <Input dir="ltr" value={reference} disabled={locked} placeholder="EX-116" onChange={(event) => setReference(event.target.value)} />
            </Field>
            <PaymentTermField value={paymentLabel} disabled={locked} onChange={setPaymentLabel} />
            <ShippingMethodField value={shippingLabel} disabled={locked} onChange={setShippingLabel} />
            <Field label={tx("originOfGoods", "بلد المنشأ")}>
              <Input dir="ltr" value={origin} disabled={locked} onChange={(event) => setOrigin(event.target.value)} />
            </Field>
            <Field label={tx("portOfLoading", "ميناء الشحن")}>
              <Input dir="ltr" value={portLoading} disabled={locked} onChange={(event) => setPortLoading(event.target.value)} />
            </Field>
            <Field label={tx("portOfDischarge", "ميناء الوصول")}>
              <Input dir="ltr" value={portDischarge} disabled={locked} onChange={(event) => setPortDischarge(event.target.value)} />
            </Field>
            <Field label={tx("seaFreight", "النولون البحري")}>
              <Input value={freight} dir="ltr" disabled={locked} onChange={(event) => setFreight(event.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-paper p-2">
            <Field label={tx("tradeInsertPreset", "إدراج صنف من الكتالوج")}>
              <Select
                value=""
                disabled={locked}
                onChange={(event) => {
                  insertPresetToInvoice(event.target.value);
                  event.target.value = "";
                }}
              >
                <option value="">{tx("tradeChoosePreset", "اختر صنفاً لإدراجه")}</option>
                {(presets.data ?? []).map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() => setLines((current) => [...current, blankInvoiceLine()])}
            >
              + {tx("tradeAddLine", "إضافة بند فاتورة")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setCatalogOpen(true)}>
              {tx("tradeManageCatalog", "إدارة الكتالوج")}
            </Button>
          </div>

          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.key} className="grid gap-2 rounded-control border border-line p-2.5 md:grid-cols-6">
                <div className="md:col-span-2">
                  <Field label={tx("description", "وصف الصنف")}>
                    <Textarea
                      className="min-h-16"
                      value={line.description}
                      disabled={locked}
                      onChange={(event) => updateLine(setLines, line.key, { description: event.target.value })}
                    />
                  </Field>
                </div>
                <Field label={tx("hsCode", "البند الجمركي (HS Code)")}>
                  <Input
                    dir="ltr"
                    value={line.hsCode}
                    disabled={locked}
                    className={line.hsCode.trim() ? "" : "border-danger"}
                    onChange={(event) => updateLine(setLines, line.key, { hsCode: event.target.value })}
                  />
                </Field>
                <Field label={tx("barcode", "الباركود")}>
                  <Input
                    dir="ltr"
                    value={line.barcode}
                    disabled={locked}
                    onChange={(event) => updateLine(setLines, line.key, { barcode: event.target.value })}
                  />
                </Field>
                <Field label={tx("unit", "الوحدة")}>
                  <Input
                    value={line.unit}
                    disabled={locked}
                    onChange={(event) => updateLine(setLines, line.key, { unit: event.target.value })}
                  />
                </Field>
                <Field label={tx("quantity", "الكمية (بالقطعة)")}>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    value={line.quantity}
                    disabled={locked}
                    onChange={(event) => updateLine(setLines, line.key, { quantity: event.target.value })}
                  />
                </Field>
                <Field label={tx("price", "سعر الوحدة")}>
                  <Input
                    dir="ltr"
                    value={line.price}
                    disabled={locked}
                    onChange={(event) => updateLine(setLines, line.key, { price: event.target.value })}
                  />
                </Field>
                <Field label={tx("amount", "إجمالي السطر")}>
                  <Input dir="ltr" readOnly value={moneyText(lineAmount(line, currency), currency)} />
                </Field>
                <div className="flex flex-wrap items-end gap-2 md:col-span-4">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={locked}
                    onClick={() => setLines((current) => [...current, { ...line, key: newKey() }])}
                  >
                    {tx("tradeCopyLine", "تكرار البند")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={locked}
                    onClick={() =>
                      setLines((current) =>
                        current.length === 1 ? [blankInvoiceLine()] : current.filter((item) => item.key !== line.key),
                      )
                    }
                  >
                    {tx("tradeRemoveLine", "حذف البند")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={locked || !line.description.trim()}
                    onClick={() =>
                      void saveLineToCatalog(line)
                        .then(() => {
                          notifySuccess(tx("tradePresetSaved", "تم حفظ الصنف في الكتالوج"));
                          return client.invalidateQueries({ queryKey: ["product-presets"] });
                        })
                        .catch(notifyError)
                    }
                  >
                    {tx("tradeSaveLineCatalog", "حفظ في الكتالوج")}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-paper px-3 py-2">
            <p className="text-sm font-semibold text-ink" dir="ltr">
              TOTAL FOB {moneyText(fob, currency)}
              {chargesFreight
                ? ` + SEA FREIGHT ${moneyText(freightMinor, currency)} = TOTAL ${shippingLabel} ${moneyText(fob + freightMinor, currency)}`
                : ""}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => setSection("packing")}>
              {tx("goToPackingTab", "الانتقال إلى بيان العبوة وتحميل الحاويات →")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* TAB 3: PACKING LIST & CONTAINERS */}
      {section === "packing" ? (
        <div className="space-y-4">
          {/* Container Management Toolbar */}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-control border border-line bg-paper/70 p-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {tx("containerCentricPackingTitle", "تحميل الحاويات وحاسبة أوزان البطاطين والملحقات")}
              </h3>
              <p className="mt-0.5 text-xs text-ink-muted">
                {tx(
                  "containerCentricPackingHint",
                  "كل حاوية مسجلة في العملية تظهر كبطاقة مستقلة بمجاميعها الخاصة. تُحسب الأوزان آلياً من (وزن القطعة الصافي + الشنطة + البوستر + الملحقات) × عدد القطع، مع إمكانية التعديل اليدوي لمطابقة ميزان البسكول.",
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {effectiveCaseId ? (
                <div className="flex items-end gap-1.5">
                  <Field label={tx("newContainerNumberOptional", "رقم الحاوية الجديدة (اختياري)")}>
                    <Input
                      dir="ltr"
                      placeholder="MRSU5942500"
                      value={newContainerNumber}
                      disabled={locked || busy}
                      onChange={(e) => setNewContainerNumber(e.target.value)}
                    />
                  </Field>
                  <Button type="button" size="sm" variant="outline" disabled={locked || busy} onClick={() => void addContainerToOperation()}>
                    + {tx("addContainerToCase", "إضافة حاوية للعملية")}
                  </Button>
                </div>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => copyInvoiceLinesToContainer(liveContainers[0]?.id ?? "")}
              >
                {tx("tradeDraftFromInvoice", "نسخ الأصناف من الفاتورة التجارية")}
              </Button>
            </div>
          </div>

          {/* Container Cards */}
          <div className="space-y-4">
            {groupedContainers.map((group, groupIndex) => {
              const containerObj = liveContainers.find((c) => c.id === group.containerId);
              const containerTitle = group.containerId
                ? `${tx("container", "الحاوية")} ${group.slotIndex ?? groupIndex + 1}: ${group.officialNumber || tx("numberPending", "بانتظار الرقم الرسمي")}`
                : tx("unassignedContainerBlock", "بنود غير مربوطة بحاوية بعد (اختر حاوية قبل الإصدار النهائي)");
              const editNum = containerObj ? (containerNumberEdits[containerObj.id] ?? containerObj.official_number ?? "") : "";

              return (
                <div
                  key={group.containerId ?? "unassigned"}
                  className="overflow-hidden rounded-card border border-line bg-card shadow-sm"
                  data-container-block={group.containerId ?? "unassigned"}
                >
                  {/* Container Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-control bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">
                        {containerTitle}
                      </span>
                      {group.status ? (
                        <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                          <Ltr>{group.status}</Ltr>
                        </span>
                      ) : null}
                    </div>
                    {containerObj && !locked ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Input
                          dir="ltr"
                          className="h-8 w-40 text-xs"
                          placeholder="MRSU5942500"
                          value={editNum}
                          onChange={(e) =>
                            setContainerNumberEdits((cur) => ({ ...cur, [containerObj.id]: e.target.value }))
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !editNum.trim()}
                          onClick={() => void saveContainerNumber(containerObj)}
                        >
                          {tx("saveContainerNumber", "حفظ رقم الحاوية")}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {/* Per-Container Action Bar */}
                  <div className="flex flex-wrap items-end gap-2 border-b border-line/70 bg-paper/40 px-3.5 py-2">
                    <Field label={tx("insertPresetIntoContainer", "إدراج منتج من الكتالوج بأوزانه التلقائية")}>
                      <Select
                        value=""
                        disabled={locked}
                        onChange={(event) => {
                          insertPresetToPackingContainer(event.target.value, group.containerId ?? "");
                          event.target.value = "";
                        }}
                      >
                        <option value="">{tx("tradeChoosePreset", "اختر صنفاً من الكتالوج...")}</option>
                        {(presets.data ?? []).map((preset) => {
                          const netG = preset.unit_net_weight_grams ?? preset.piece_weight_grams ?? 0;
                          const bagG = preset.bag_weight_grams ?? 0;
                          const posterG = preset.poster_weight_grams ?? 0;
                          return (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} ({kgText(netG)} kg + شنطة {kgText(bagG)} + بوستر {kgText(posterG)})
                            </option>
                          );
                        })}
                      </Select>
                    </Field>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={locked}
                      onClick={() =>
                        setPacking((current) => [
                          ...current,
                          blankPackingLine(group.containerId ?? ""),
                        ])
                      }
                    >
                      + {tx("addProductPackingLine", "إضافة بند منتج (بطاطين)")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={locked}
                      onClick={() =>
                        setPacking((current) => [
                          ...current,
                          blankAccessoryPackingLine(group.containerId ?? ""),
                        ])
                      }
                    >
                      + {tx("addStandaloneAccessoryLine", "إضافة ملحق مفرد (شنط / بوسترات / كراتين إضافية)")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={locked}
                      onClick={() => copyInvoiceLinesToContainer(group.containerId ?? "")}
                    >
                      {tx("copyFromInvoiceToContainer", "نسخ بنود الفاتورة لهذه الحاوية")}
                    </Button>
                  </div>

                  {/* Container Lines */}
                  <div className="divide-y divide-line/70 p-3">
                    {group.lines.length === 0 ? (
                      <p className="py-4 text-center text-xs text-ink-muted">
                        {tx("emptyContainerLines", "لا توجد أصناف محملة في هذه الحاوية بعد. اختر من الكتالوج أو أضف بند منتج أو ملحق مفرد.")}
                      </p>
                    ) : (
                      group.lines.map(({ draft: line, calc }) => {
                        const heavy = calc.netWeightGrams > calc.grossWeightGrams;
                        const isAccessory = line.lineType === "ACCESSORY";
                        return (
                          <div key={line.key} className="space-y-2.5 py-3 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                                    isAccessory ? "bg-warn/15 text-warn" : "bg-accent/15 text-accent",
                                  )}
                                >
                                  {isAccessory
                                    ? tx("lineTypeAccessory", "ملحق مفرد (شنط / بوسترات / كراتين إضافية)")
                                    : tx("lineTypeProduct", "منتج أساسي (بطانية / منسوجات)")}
                                </span>
                                <Select
                                  value={line.lineType}
                                  disabled={locked}
                                  className="h-7 text-xs"
                                  onChange={(e) => {
                                    const nextType = e.target.value === "ACCESSORY" ? "ACCESSORY" : "PRODUCT";
                                    updatePackingLine(line.key, {
                                      lineType: nextType,
                                      includePiecesInReconciliation: nextType === "PRODUCT",
                                    });
                                  }}
                                >
                                  <option value="PRODUCT">{tx("lineTypeProductShort", "منتج أساسي")}</option>
                                  <option value="ACCESSORY">{tx("lineTypeAccessoryShort", "ملحق مفرد")}</option>
                                </Select>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Field label={tx("container", "الحاوية")}>
                                  <Select
                                    value={line.containerId}
                                    disabled={locked}
                                    className="h-8 text-xs"
                                    onChange={(event) => updatePackingLine(line.key, { containerId: event.target.value })}
                                  >
                                    <option value="">{tx("tradeChooseContainer", "اختر الحاوية")}</option>
                                    {liveContainers.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {tx("container", "الحاوية")} {item.slot_index ?? ""}: {item.official_number || tx("numberPending", "بدون رقم")}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                {!isAccessory ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={locked || !line.description.trim()}
                                    onClick={() =>
                                      void savePackingLineToCatalog(line)
                                        .then(() => {
                                          notifySuccess(tx("tradePresetSaved", "تم حفظ الصنف وأوزانه في الكتالوج"));
                                          return client.invalidateQueries({ queryKey: ["product-presets"] });
                                        })
                                        .catch(notifyError)
                                    }
                                  >
                                    {tx("saveWeightsToCatalog", "حفظ الصنف وأوزانه بالكتالوج")}
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={locked}
                                  onClick={() =>
                                    setPacking((current) =>
                                      current.length === 1
                                        ? [blankPackingLine(group.containerId ?? "")]
                                        : current.filter((item) => item.key !== line.key),
                                    )
                                  }
                                >
                                  {tx("tradeRemoveLine", "حذف السطر")}
                                </Button>
                              </div>
                            </div>

                            {/* Basic Line Quantities */}
                            <div className="grid gap-2 md:grid-cols-6">
                              <div className="md:col-span-2">
                                <Field label={tx("description", isAccessory ? "وصف الملحق (شنط / بوسترات / كراتين)" : "وصف المنتج")}>
                                  <Textarea
                                    className="min-h-14"
                                    value={line.description}
                                    disabled={locked}
                                    onChange={(event) => updatePackingLine(line.key, { description: event.target.value })}
                                  />
                                </Field>
                              </div>
                              <Field label={tx("hsCode", "HS Code")}>
                                <Input
                                  dir="ltr"
                                  value={line.hsCode}
                                  disabled={locked}
                                  onChange={(event) => updatePackingLine(line.key, { hsCode: event.target.value })}
                                />
                              </Field>
                              <Field label={tx("packages", "عدد الطرود / البالات")}>
                                <Input
                                  dir="ltr"
                                  inputMode="numeric"
                                  value={line.packages}
                                  disabled={locked}
                                  onChange={(event) => updatePackingLine(line.key, { packages: event.target.value })}
                                />
                              </Field>
                              <Field label={tx("packingPerPackage", "التعبئة في الطرد")}>
                                <Input
                                  dir="ltr"
                                  inputMode="numeric"
                                  value={line.perPackage}
                                  disabled={locked}
                                  onChange={(event) => updatePackingLine(line.key, { perPackage: event.target.value })}
                                />
                              </Field>
                              <Field label={tx("pieces", "إجمالي القطع (الطرود × التعبئة)")}>
                                <Input dir="ltr" readOnly value={String(calc.piecesCount)} />
                              </Field>
                            </div>

                            {/* Component Weight Calculator + Extra Accessories */}
                            <div className="rounded-control border border-line/80 bg-paper/50 p-2.5">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-ink">
                                  {tx(
                                    "weightCalculatorTitle",
                                    "حاسبة مكونات وزن القطعة الواحدة بالكيلوجرام (المنتج الصافي + الشنطة + البوستر + ملحقات أخرى)",
                                  )}
                                </span>
                                <span className="text-xs font-semibold text-accent" dir="ltr">
                                  Unit Gross = {kgText(calc.unitGrossWeightGrams)} kg/pc ({calc.unitGrossWeightGrams} g)
                                </span>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-5">
                                <Field label={tx("unitNetKg", "وزن القطعة الصافي (كجم)")}>
                                  <Input
                                    dir="ltr"
                                    inputMode="decimal"
                                    value={line.unitNetKg}
                                    disabled={locked}
                                    onChange={(e) => updatePackingLine(line.key, { unitNetKg: e.target.value, manualOverride: false })}
                                  />
                                </Field>
                                <Field label={tx("bagKg", "وزن الشنطة للقطعة (كجم)")}>
                                  <Input
                                    dir="ltr"
                                    inputMode="decimal"
                                    value={line.bagKg}
                                    disabled={locked}
                                    onChange={(e) => updatePackingLine(line.key, { bagKg: e.target.value, manualOverride: false })}
                                  />
                                </Field>
                                <Field label={tx("posterKg", "وزن البوستر/الكرتونة للقطعة (كجم)")}>
                                  <Input
                                    dir="ltr"
                                    inputMode="decimal"
                                    value={line.posterKg}
                                    disabled={locked}
                                    onChange={(e) => updatePackingLine(line.key, { posterKg: e.target.value, manualOverride: false })}
                                  />
                                </Field>
                                <Field label={tx("otherAccessoryKg", "ملحق إضافي للقطعة (كجم)")}>
                                  <Input
                                    dir="ltr"
                                    inputMode="decimal"
                                    value={line.otherAccessoryKg}
                                    disabled={locked}
                                    onChange={(e) => updatePackingLine(line.key, { otherAccessoryKg: e.target.value, manualOverride: false })}
                                  />
                                </Field>
                                <Field label={tx("unitGrossKg", "إجمالي قائم القطعة (كجم)")}>
                                  <Input dir="ltr" readOnly value={kgText(calc.unitGrossWeightGrams)} />
                                </Field>
                              </div>

                              {/* Optional named extra accessories per piece */}
                              {line.extraAccessories.length > 0 ? (
                                <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
                                  {line.extraAccessories.map((acc, accIdx) => (
                                    <div key={accIdx} className="flex flex-wrap items-center gap-2 text-xs">
                                      <Input
                                        className="h-7 w-44 text-xs"
                                        placeholder={tx("accessoryName", "اسم الملحق (شماعة / كيس...) ")}
                                        value={acc.name}
                                        disabled={locked}
                                        onChange={(e) => {
                                          const nextAcc = line.extraAccessories.map((a, i) =>
                                            i === accIdx ? { ...a, name: e.target.value } : a,
                                          );
                                          updatePackingLine(line.key, { extraAccessories: nextAcc, manualOverride: false });
                                        }}
                                      />
                                      <Input
                                        dir="ltr"
                                        inputMode="decimal"
                                        className="h-7 w-28 text-xs"
                                        value={kgText(acc.weightGrams)}
                                        disabled={locked}
                                        onChange={(e) => {
                                          const nextAcc = line.extraAccessories.map((a, i) =>
                                            i === accIdx ? { ...a, weightGrams: safeGrams(e.target.value) } : a,
                                          );
                                          const sumG = nextAcc.reduce((s, a) => s + a.weightGrams, 0);
                                          updatePackingLine(line.key, {
                                            extraAccessories: nextAcc,
                                            otherAccessoryKg: kgText(sumG),
                                            manualOverride: false,
                                          });
                                        }}
                                      />
                                      <span className="text-ink-muted">kg/pc</span>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={locked}
                                        onClick={() => {
                                          const nextAcc = line.extraAccessories.filter((_, i) => i !== accIdx);
                                          const sumG = nextAcc.reduce((s, a) => s + a.weightGrams, 0);
                                          updatePackingLine(line.key, {
                                            extraAccessories: nextAcc,
                                            otherAccessoryKg: kgText(sumG),
                                            manualOverride: false,
                                          });
                                        }}
                                      >
                                        ×
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={locked}
                                  onClick={() =>
                                    updatePackingLine(line.key, {
                                      extraAccessories: [...line.extraAccessories, { name: "ملحق إضافي", weightGrams: 0 }],
                                    })
                                  }
                                >
                                  + {tx("addNamedAccessory", "إضافة ملحق مسمى للقطعة")}
                                </Button>

                                <div className="flex flex-wrap items-center gap-3 text-xs">
                                  <label className="inline-flex items-center gap-1.5 font-medium text-ink">
                                    <input
                                      type="checkbox"
                                      checked={line.manualOverride}
                                      disabled={locked}
                                      onChange={(e) =>
                                        updatePackingLine(line.key, { manualOverride: e.target.checked })
                                      }
                                    />
                                    {tx("manualBasculeOverride", "تعديل الوزن الكلي يدوياً (مطابقة ميزان البسكول)")}
                                  </label>
                                  {isAccessory ? (
                                    <label className="inline-flex items-center gap-1.5 font-medium text-ink">
                                      <input
                                        type="checkbox"
                                        checked={shouldIncludePiecesInReconciliation(
                                          line.lineType,
                                          line.includePiecesInReconciliation,
                                        )}
                                        disabled={locked}
                                        onChange={(e) =>
                                          updatePackingLine(line.key, {
                                            includePiecesInReconciliation: e.target.checked,
                                          })
                                        }
                                      />
                                      {tx("includeAccessoryPiecesInReconciliation", "احتساب عدد هذا الملحق ضمن مطابقة قطع الفاتورة")}
                                    </label>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            {/* Final Line Net & Gross Weights */}
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Field
                                label={tx("netKg", "الوزن الصافي الكلي للسطر بدون شنط (Net Weight kg)")}
                                error={heavy ? tx("netAboveGross", "لا يمكن أن يزيد الوزن الصافي على الوزن القائم.") : undefined}
                              >
                                <Input
                                  dir="ltr"
                                  value={line.netKg}
                                  disabled={locked}
                                  className={heavy ? "border-danger" : ""}
                                  onChange={(event) =>
                                    updatePackingLine(line.key, { netKg: event.target.value, manualOverride: true })
                                  }
                                />
                              </Field>
                              <Field label={tx("grossKg", "الوزن القائم الكلي للسطر بالشنط والملحقات (Gross Weight kg)")}>
                                <Input
                                  dir="ltr"
                                  value={line.grossKg}
                                  disabled={locked}
                                  onChange={(event) =>
                                    updatePackingLine(line.key, { grossKg: event.target.value, manualOverride: true })
                                  }
                                />
                              </Field>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Container Subtotal Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper/80 px-3.5 py-2.5 text-xs font-semibold text-ink">
                    <span>
                      {tx("containerSubtotalLabel", "ملخص إجمالي هذه الحاوية")}:
                    </span>
                    <div className="flex flex-wrap items-center gap-4" dir="ltr">
                      <span>{tx("packages", "Packages")}: {group.totals.packagesCount}</span>
                      <span>
                        {tx("pieces", "Pieces")}: {group.totals.piecesCount}
                        {group.totals.accessoryPiecesCount > 0
                          ? ` (${group.totals.productPiecesCount} product + ${group.totals.accessoryPiecesCount} accessory)`
                          : ""}
                      </span>
                      <span>{tx("netKg", "Net")}: {kgText(group.totals.netWeightGrams)} kg</span>
                      <span>{tx("grossKg", "Gross")}: {kgText(group.totals.grossWeightGrams)} kg</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grand Total Packing Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-accent/30 bg-accent/[0.06] px-4 py-3 text-sm font-semibold text-ink">
            <span>{tx("packingGrandTotal", "الإجمالي العام لبيان العبوة (جميع الحاويات)")}</span>
            <span dir="ltr">
              {tx("packages", "Packages")} {summary.packing.packages} · {tx("pieces", "Reconciled Pieces")} {summary.packing.pieces} · {tx("netKg", "Net")} {kgText(summary.packing.netGrams)} kg · {tx("grossKg", "Gross")} {kgText(summary.packing.grossGrams)} kg
            </span>
          </div>
        </div>
      ) : null}

      {/* TAB 4: LIVE A4 PREVIEW & STAMP */}
      {section === "preview" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-paper px-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={liveDoc === "proforma" ? "default" : "outline"}
                onClick={() => setLiveDoc("proforma")}
              >
                {tx("previewProforma", "معاينة الفاتورة المبدئية")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={liveDoc === "commercial" ? "default" : "outline"}
                onClick={() => setLiveDoc("commercial")}
              >
                {tx("tradeLiveInvoice", "معاينة الفاتورة التجارية")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={liveDoc === "packing" ? "default" : "outline"}
                onClick={() => setLiveDoc("packing")}
              >
                {tx("tradeLivePacking", "معاينة بيان العبوة")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={liveDoc === "customs" ? "default" : "outline"}
                onClick={() => setLiveDoc("customs")}
              >
                {tx("previewCustomsBundle", "معاينة الملف الجمركي المدمج")}
              </Button>
            </div>
            <span className="text-xs font-medium text-ink-muted">
              {tx("livePreviewHint", "تحكم في الحقول المطبوعة وموضع الختم وحمّل نسخ PDF الرسمية")}
            </span>
          </div>

          <PrintFieldsPanel
            customerId={customerId}
            fields={printFields}
            disabled={locked}
            document={{ date: invoiceDate, invoiceNumber: invoiceNumber || invoiceId, reference }}
            onChange={setPrintFields}
          />

          {liveDoc === "customs" ? (
            <div className="space-y-4">
              <LiveInvoiceView
                model={buildSheetModel("commercial")}
                stamp={stamp}
                disabled={locked}
                onChange={setStamp}
              />
              <LiveInvoiceView
                model={buildSheetModel("packing")}
                stamp={packingStamp}
                disabled={locked}
                onChange={setPackingStamp}
              />
            </div>
          ) : (
            <LiveInvoiceView
              model={buildSheetModel(liveDoc)}
              stamp={liveDoc === "packing" ? packingStamp : stamp}
              disabled={locked}
              onChange={liveDoc === "packing" ? setPackingStamp : setStamp}
            />
          )}
        </div>
      ) : null}

      {/* Persistent Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={locked || busy} onClick={() => void saveDraft()}>
            {tx("tradeSaveDraft", "حفظ المسودة")}
          </Button>
          <Button type="button" variant="outline" disabled={locked || busy} onClick={() => void sync()}>
            {tx("tradeSync", "مزامنة الملخص من الباكنج ليست")}
          </Button>
          <Button type="button" disabled={locked || busy} onClick={() => void issue()}>
            {tx("tradeIssue", "إصدار نهائي وإرفاق بالعملية")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void downloadPdf(
                `/api/v1/invoices/${invoiceId}/commercial-pdf`,
                tradePdfFilename({
                  invoiceNumber: invoiceNumber || invoiceId,
                  clientName: customerName || "CLIENT",
                  clientCode: customerCode || "NA",
                  country: customerCountry || "NA",
                }),
              ).catch((error) => notifyError(error))
            }
          >
            {tx("tradeDownloadInvoice", "PDF الفاتورة التجارية")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void downloadPdf(
                `/api/v1/invoices/${invoiceId}/packing-pdf`,
                tradePdfFilename({
                  invoiceNumber: invoiceNumber || invoiceId,
                  clientName: customerName || "CLIENT",
                  clientCode: customerCode || "NA",
                  country: customerCountry || "NA",
                }),
              ).catch((error) => notifyError(error))
            }
          >
            {tx("tradeDownloadPacking", "PDF بيان العبوة")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void downloadPdf(
                `/api/v1/invoices/${invoiceId}/customs-pdf`,
                tradePdfFilename({
                  invoiceNumber: invoiceNumber || invoiceId,
                  clientName: customerName || "CLIENT",
                  clientCode: customerCode || "NA",
                  country: customerCountry || "NA",
                }),
              ).catch((error) => notifyError(error))
            }
          >
            {tx("tradeDownloadCustoms", "PDF الملف الجمركي المدمج")}
          </Button>
        </div>
      </div>

      <CompanyDialog open={companyOpen} onClose={() => setCompanyOpen(false)} />
      <CatalogDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} />
    </section>
  );
}

function ReconciliationBar({
  summary,
  locked,
  busy,
  onSync,
}: {
  summary: ReturnType<typeof liveReconciliation>;
  locked: boolean;
  busy: boolean;
  onSync: () => void;
}) {
  const { tx } = useCopy();
  const rows = [
    [tx("pieces", "القطع"), summary.invoice.pieces, summary.packing.pieces, summary.differences.pieces],
    [tx("packages", "الطرود"), summary.invoice.packages, summary.packing.packages, summary.differences.packages],
    [tx("grossKg", "الوزن القائم (كجم)"), summary.invoice.grossGrams / 1000, summary.packing.grossGrams / 1000, summary.differences.grossGrams / 1000],
    [tx("netKg", "الوزن الصافي (كجم)"), summary.invoice.netGrams / 1000, summary.packing.netGrams / 1000, summary.differences.netGrams / 1000],
  ] as const;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-control border px-3.5 py-2.5 text-sm",
        summary.matched ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger",
      )}
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {summary.matched
            ? tx("tradeMatched", "شريط المطابقة الجمركية اللحظي: مجاميع الفاتورة التجارية وبيان العبوة متطابقة تماماً ✓")
            : tx("tradeDiffers", "شريط المطابقة الجمركية اللحظي: توجد فروق بين ملخص الفاتورة التجارية ومجاميع بيان العبوة")}
        </p>
        <p className="mt-1 text-xs">
          {rows
            .map(([label, invVal, packVal, diff]) => {
              const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
              return `${label}: فاتورة (${fmt(invVal)}) / باكنج (${fmt(packVal)}) [الفرق ${diff > 0 ? "+" : ""}${fmt(diff)}]`;
            })
            .join(" · ")}
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={locked || busy} onClick={onSync}>
        {tx("tradeSync", "مزامنة الملخص من الباكنج ليست")}
      </Button>
    </div>
  );
}

function blankInvoiceLine(): InvoiceDraftLine {
  return { key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" };
}

function blankPackingLine(containerId = ""): PackingDraftLine {
  return {
    key: newKey(),
    containerId,
    lineType: "PRODUCT",
    description: "",
    hsCode: "",
    barcode: "",
    packages: "1",
    perPackage: "1",
    unitNetKg: "0.000",
    bagKg: "0.000",
    posterKg: "0.000",
    otherAccessoryKg: "0.000",
    extraAccessories: [],
    manualOverride: false,
    includePiecesInReconciliation: true,
    grossKg: "0.000",
    netKg: "0.000",
  };
}

function blankAccessoryPackingLine(containerId = ""): PackingDraftLine {
  return {
    key: newKey(),
    containerId,
    lineType: "ACCESSORY",
    description: "",
    hsCode: "",
    barcode: "",
    packages: "1",
    perPackage: "1",
    unitNetKg: "0.000",
    bagKg: "0.000",
    posterKg: "0.000",
    otherAccessoryKg: "0.000",
    extraAccessories: [],
    manualOverride: true,
    includePiecesInReconciliation: false,
    grossKg: "0.000",
    netKg: "0.000",
  };
}

function toInvoiceLine(line: SheetLine): InvoiceDraftLine {
  return {
    key: newKey(),
    description: line.description,
    hsCode: line.hs_code ?? "",
    barcode: line.barcode ?? "",
    unit: line.unit_label ?? "PCS",
    quantity: String(line.quantity),
    price: moneyText(line.unit_price_minor),
  };
}

function toPackingLine(line: SheetPack): PackingDraftLine {
  const lineType: PackingLineType = line.line_type === "ACCESSORY" ? "ACCESSORY" : "PRODUCT";
  const extraAccessories: ExtraAccessory[] = parseExtraAccessories(line.extra_accessories_json);
  const unitNetGrams = Number(line.unit_net_weight_grams ?? 0);
  const bagGrams = Number(line.bag_weight_grams ?? 0);
  const posterGrams = Number(line.poster_weight_grams ?? 0);
  const otherGrams = Number(line.other_accessory_weight_grams ?? 0);
  const hasComponents = unitNetGrams > 0 || bagGrams > 0 || posterGrams > 0 || otherGrams > 0 || extraAccessories.length > 0;
  return {
    key: newKey(),
    containerId: line.container_id ?? "",
    lineType,
    description: line.description,
    hsCode: line.hs_code ?? "",
    barcode: line.barcode ?? "",
    packages: String(line.packages_count),
    perPackage: String(line.packing_per_package),
    unitNetKg: kgText(unitNetGrams),
    bagKg: kgText(bagGrams),
    posterKg: kgText(posterGrams),
    otherAccessoryKg: kgText(otherGrams),
    extraAccessories,
    manualOverride: Number(line.manual_weight_override) === 1 || (!hasComponents && (line.gross_weight_grams > 0 || line.net_weight_grams > 0)),
    includePiecesInReconciliation: shouldIncludePiecesInReconciliation(lineType, line.include_pieces_in_reconciliation),
    grossKg: kgText(line.gross_weight_grams),
    netKg: kgText(line.net_weight_grams),
  };
}

function serializeInvoice(line: InvoiceDraftLine) {
  return {
    description: line.description,
    hsCode: line.hsCode,
    barcode: line.barcode,
    unit: line.unit,
    quantity: Number(line.quantity),
    unitPriceMinor: moneyMinor(line.price),
  };
}

function serializePacking(line: PackingDraftLine) {
  const calc = computeDraftPackingWeights(line);
  return {
    description: line.description,
    hsCode: line.hsCode,
    barcode: line.barcode ?? null,
    containerId: line.containerId || null,
    lineType: line.lineType,
    packagesCount: Number(line.packages),
    packingPerPackage: Number(line.perPackage),
    unitNetWeightGrams: calc.unitNetWeightGrams,
    bagWeightGrams: calc.bagWeightGrams,
    posterWeightGrams: calc.posterWeightGrams,
    otherAccessoryWeightGrams: calc.otherAccessoryWeightGrams,
    extraAccessories: line.extraAccessories,
    manualWeightOverride: line.manualOverride,
    includePiecesInReconciliation: line.includePiecesInReconciliation,
    grossWeightGrams: calc.grossWeightGrams,
    netWeightGrams: calc.netWeightGrams,
  };
}

function updateLine<T extends { key: string }>(set: (value: (current: T[]) => T[]) => void, key: string, patch: Partial<T>) {
  set((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
}
