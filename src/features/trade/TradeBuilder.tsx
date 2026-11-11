import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkPlus,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Container,
  Copy,
  FileDown,
  FileSpreadsheet,
  Plus,
  ReceiptText,
  RefreshCw,
  Scale,
  Ship,
  Sparkles,
  Stamp,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from "@/lib/offline-drafts";
import { useCopy } from "@/lib/copy";
import { usePermissions } from "@/lib/permissions";
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
import {
  CatalogDialog,
  CompanyDialog,
  PaymentPresetStrip,
  PaymentTermField,
  saveLineToCatalog,
  savePackingLineToCatalog,
} from "./TradeDialogs";
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
  const perms = usePermissions();
  const client = useQueryClient();
  const sheet = useQuery({
    queryKey: ["trade-sheet", invoiceId],
    queryFn: async () => (await api<Sheet>(`/api/v1/invoices/${invoiceId}/trade-sheet`)).data,
  });
  const banks = useQuery({
    queryKey: ["exporter-banks"],
    queryFn: async () => (await api<BankAccount[]>("/api/v1/settings/exporter-bank-accounts")).data,
    staleTime: 5 * 60_000,
  });
  const presets = useQuery({
    queryKey: ["product-presets"],
    queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data,
    staleTime: 5 * 60_000,
  });
  const identity = useQuery({
    queryKey: ["exporter-identity"],
    queryFn: async () => (await api<Record<string, string | null> | null>("/api/v1/settings/exporter-identity")).data,
    staleTime: 5 * 60_000,
  });

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
  const [expandedWeights, setExpandedWeights] = useState<Record<string, boolean>>({});
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(null);
  const baselineSnapshotRef = useRef<string>("");
  const draftScopeKey = `trade:${invoiceId}`;

  const issued = sheet.data?.header.trade_status === "ISSUED";
  const canEditInvoice = !issued && canEdit && perms.has("invoices.edit");
  const canIssueInvoice = !issued && canEdit && perms.has("invoices.issue");
  const canEditPacking = !issued && canEdit && perms.has("packing.edit");
  const canOverrideWeights = !issued && canEdit && perms.has("packing.weights_override");
  const canManageCatalog = perms.has("catalog.products.manage");
  const canManageCompanyOrBank = perms.hasAny(["settings.manage", "exporter.bank_accounts.manage"]);
  const locked = issued || !canEdit || (section === "packing" ? !canEditPacking : !canEditInvoice);
  const effectiveCaseId = caseId || sheet.data?.header.case_id || "";

  const liveContainers = useMemo(() => {
    const raw = (sheet.data?.containers?.length ? sheet.data.containers : containers).filter(
      (item) => item.status !== "CANCELLED",
    );
    return [...raw].sort((a, b) => (Number(a.slot_index) || 0) - (Number(b.slot_index) || 0));
  }, [sheet.data, containers]);

  const liveBookings = useMemo(() => {
    const raw = sheet.data?.bookings?.length ? sheet.data.bookings : bookings;
    return raw.filter((item) => item.status !== "CANCELLED");
  }, [sheet.data, bookings]);

  useEffect(() => {
    const data = sheet.data;
    if (!data || ready) return;
    const defaultContainerId = (data.containers ?? containers).find((c) => c.status !== "CANCELLED")?.id ?? "";
    const serverLines = data.lines.length ? data.lines.map(toInvoiceLine) : [blankInvoiceLine()];
    const serverPacking = data.packing.length ? data.packing.map(toPackingLine) : [blankPackingLine(defaultContainerId)];
    const serverPaymentLabel = data.header.payment_term_label ?? "";
    const serverReference = data.header.print_reference || customerCode;
    const serverShippingLabel = data.header.shipping_method_label ?? "CFR";
    const serverOrigin = data.header.origin_of_goods ?? "EGYPT";
    const serverPortLoading = data.header.port_of_loading ?? "";
    const serverPortDischarge = data.header.port_of_discharge ?? "";
    const serverBankId = data.header.exporter_bank_account_id ?? "";
    const serverFreight = moneyText(Number(data.header.invoiced_freight_minor ?? 0), currency);

    baselineSnapshotRef.current = JSON.stringify({
      lines: serverLines.map(({ key: _k, ...rest }) => rest),
      packing: serverPacking.map(({ key: _k, ...rest }) => rest),
      paymentLabel: serverPaymentLabel,
      reference: serverReference,
      shippingLabel: serverShippingLabel,
      origin: serverOrigin,
      portLoading: serverPortLoading,
      portDischarge: serverPortDischarge,
      bankId: serverBankId,
      freight: serverFreight,
    });

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
    setPackages(Number(data.header.packages_count ?? 0));
    setGross(Number(data.header.gross_weight_grams ?? 0));
    setNet(Number(data.header.net_weight_grams ?? 0));

    if (data.header.trade_status !== "ISSUED") {
      const localDraft = loadLocalDraft<{
        lines: InvoiceDraftLine[];
        packing: PackingDraftLine[];
        paymentLabel: string;
        reference: string;
        shippingLabel: string;
        origin: string;
        portLoading: string;
        portDischarge: string;
        bankId: string;
        freight: string;
      }>(draftScopeKey);
      if (localDraft?.payload) {
        setLines(localDraft.payload.lines?.length ? localDraft.payload.lines : serverLines);
        setPacking(localDraft.payload.packing?.length ? localDraft.payload.packing : serverPacking);
        setPaymentLabel(localDraft.payload.paymentLabel ?? serverPaymentLabel);
        setReference(localDraft.payload.reference ?? serverReference);
        setShippingLabel(localDraft.payload.shippingLabel ?? serverShippingLabel);
        setOrigin(localDraft.payload.origin ?? serverOrigin);
        setPortLoading(localDraft.payload.portLoading ?? serverPortLoading);
        setPortDischarge(localDraft.payload.portDischarge ?? serverPortDischarge);
        setBankId(localDraft.payload.bankId ?? serverBankId);
        setFreight(localDraft.payload.freight ?? serverFreight);
        setRestoredDraftAt(localDraft.updatedAt);
        setReady(true);
        return;
      }
    } else {
      clearLocalDraft(draftScopeKey);
    }

    setLines(serverLines);
    setPacking(serverPacking);
    setPaymentLabel(serverPaymentLabel);
    setReference(serverReference);
    setShippingLabel(serverShippingLabel);
    setOrigin(serverOrigin);
    setPortLoading(serverPortLoading);
    setPortDischarge(serverPortDischarge);
    setBankId(serverBankId);
    setFreight(serverFreight);
    setRestoredDraftAt(null);
    setReady(true);
  }, [sheet.data, ready, currency, customerCode, containers, draftScopeKey]);

  useEffect(() => {
    if (!ready || issued) return;
    const currentComparable = JSON.stringify({
      lines: lines.map(({ key: _k, ...rest }) => rest),
      packing: packing.map(({ key: _k, ...rest }) => rest),
      paymentLabel,
      reference,
      shippingLabel,
      origin,
      portLoading,
      portDischarge,
      bankId,
      freight,
    });
    if (currentComparable === baselineSnapshotRef.current) return;
    const timer = setTimeout(() => {
      saveLocalDraft(draftScopeKey, sheet.data?.header.trade_status ?? "DRAFT", {
        lines,
        packing,
        paymentLabel,
        reference,
        shippingLabel,
        origin,
        portLoading,
        portDischarge,
        bankId,
        freight,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [
    ready,
    issued,
    lines,
    packing,
    paymentLabel,
    reference,
    shippingLabel,
    origin,
    portLoading,
    portDischarge,
    bankId,
    freight,
    draftScopeKey,
    sheet.data?.header.trade_status,
  ]);

  function discardLocalDraft() {
    clearLocalDraft(draftScopeKey);
    setRestoredDraftAt(null);
    setReady(false);
    notifySuccess(tx("localDraftDiscarded", "تم تجاهل المسودة المحلية واستعادة بيانات الخادم"));
  }

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
  const effectiveFreightMinor = chargesFreight ? freightMinor : 0;
  const grandTotalMinor = fob + effectiveFreightMinor;

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
      if (saved.meta?.queuedOffline) {
        notifySuccess(
          tx(
            "tradeQueuedOffline",
            "تم حفظ المسودة محلياً في طابور المزامنة — ستتم مزامنتها تلقائياً فور عودة الاتصال",
          ),
        );
      } else {
        clearLocalDraft(draftScopeKey);
        setRestoredDraftAt(null);
        baselineSnapshotRef.current = JSON.stringify({
          lines: lines.map(({ key: _k, ...rest }) => rest),
          packing: packing.map(({ key: _k, ...rest }) => rest),
          paymentLabel,
          reference,
          shippingLabel,
          origin,
          portLoading,
          portDischarge,
          bankId,
          freight,
        });
        notifySuccess(
          saved.data.reconciliation.matched
            ? tx("tradeDraftSaved", "تم حفظ المسودة والمجاميع متطابقة")
            : tx("tradeDraftDiffers", "تم حفظ المسودة. لا تزال هناك فروق في المطابقة."),
        );
        await client.invalidateQueries({ queryKey: ["trade-sheet", invoiceId] });
        await client.invalidateQueries({ queryKey: ["case"] });
      }
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
      notifySuccess(tx("tradeSynced", "تمت مزامنة ملخص الطرود والأوزان مع بيان العبوة"));
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
      clearLocalDraft(draftScopeKey);
      setRestoredDraftAt(null);
      notifySuccess(tx("tradeIssued", "تم إصدار الفاتورة التجارية وبيان العبوة وإرفاقهما بالمستندات"));
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
        unit: preset.unit_label ?? "Piece",
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

  function toggleWeightPanel(key: string) {
    setExpandedWeights((current) => ({ ...current, [key]: !current[key] }));
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
    <div className="space-y-4" data-trade-workspace="unified">
      {restoredDraftAt && !issued ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-xs"
          data-testid="trade-local-draft-banner"
        >
          <div className="flex items-center gap-2 font-medium text-ink">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" />
            <span>
              {tx(
                "localDraftRestoredNotice",
                "تمت استعادة مسودة محلية غير محفوظة تلقائياً لحماية تعديلاتك وأوزان الباسكول.",
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRestoredDraftAt(null)}
            >
              {tx("keepLocalDraft", "الاحتفاظ بالمسودة")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={discardLocalDraft}
            >
              {tx("discardLocalDraft", "تجاهل المسودة المحلية")}
            </Button>
          </div>
        </div>
      ) : null}
      {/* 1. Executive KPI Strip (5 Equal-Height Cards) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {/* KPI 1: Invoice Number & Customer */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-card p-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-semibold text-ink-muted">{tx("kpiInvoiceAndCustomer", "رقم الفاتورة والعميل")}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide",
                issued ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn",
              )}
              dir="ltr"
            >
              {issued ? "ISSUED" : "DRAFT"}
            </span>
          </div>
          <div className="mt-2">
            <p className="truncate text-sm font-bold text-ink" dir="ltr">
              {invoiceNumber || invoiceId}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              <span className="truncate font-medium text-ink">{customerName || "—"}</span>
              {(reference || customerCode) ? (
                <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent" dir="ltr">
                  {reference || customerCode}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* KPI 2: Shipping Method & Route */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-card p-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-semibold text-ink-muted">{tx("shippingMethod", "طريقة الشحن")}</span>
            <Ship className="h-3.5 w-3.5 text-ink-muted" />
          </div>
          <div className="mt-2">
            <span className="inline-flex rounded-md border border-line bg-paper px-2 py-0.5 text-xs font-bold text-ink" dir="ltr">
              {shippingLabel || "CFR"}
            </span>
            <p className="mt-1 truncate text-[11px] text-ink-muted" dir="ltr">
              {portLoading || origin || "EGYPT"} {portDischarge ? `→ ${portDischarge}` : ""}
            </p>
          </div>
        </div>

        {/* KPI 3: Goods Value (FOB) */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-card p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold text-ink-muted">{tx("kpiFobValue", "قيمة البضاعة (FOB)")}</span>
          <div className="mt-2">
            <p className="text-base font-bold tabular-nums text-ink" dir="ltr">
              {moneyText(fob, currency)} <span className="text-xs font-semibold text-ink-muted">{currency}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {summary.invoice.pieces} {tx("piecesUnit", "قطعة")} · {lines.length} {tx("itemsCountLabel", "بنود")}
            </p>
          </div>
        </div>

        {/* KPI 4: Sea Freight Cost */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-card p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold text-ink-muted">{tx("kpiSeaFreight", "تكلفة الشحن البحري")}</span>
          <div className="mt-2">
            <p className="text-base font-bold tabular-nums text-ink" dir="ltr">
              {moneyText(effectiveFreightMinor, currency)}{" "}
              <span className="text-xs font-semibold text-ink-muted">{currency}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {chargesFreight
                ? tx("freightIncludedBadge", "مضاف لإجمالي الفاتورة")
                : tx("freightExcludedBadge", "غير مضاف (شحن FOB)")}
            </p>
          </div>
        </div>

        {/* KPI 5: Final Invoice Total */}
        <div className="col-span-2 flex flex-col justify-between rounded-xl border border-accent/35 bg-accent/[0.06] p-3.5 shadow-sm md:col-span-1">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-bold text-accent">{tx("kpiFinalTotal", "الإجمالي النهائي للفاتورة")}</span>
            {stamp.stamped ? (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                {tx("tradeStamped", "مختومة")}
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            <p className="text-lg font-extrabold tabular-nums text-accent" dir="ltr">
              {moneyText(grandTotalMinor, currency)} <span className="text-xs font-bold">{currency}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-ink-muted" dir="ltr">
              {invoiceDate || "—"}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Main Unified Trade Workspace Container */}
      <section className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
        <div className="space-y-4 p-4">
          {/* 4-Column Reconciliation Matrix + 5th Column Sync Button */}
          <ReconciliationBar
            summary={summary}
            locked={locked}
            busy={busy}
            onSync={() => void sync()}
          />

          {/* Clean 4-Tab Trade Navigation Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={tx("tradeWorkspaceTabs", "تبويبات المستندات التجارية")}>
              <Button
                type="button"
                size="sm"
                role="tab"
                aria-selected={section === "proforma"}
                variant={section === "proforma" ? "default" : "outline"}
                onClick={() => setSection("proforma")}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>1. {tx("tabProformaClean", "الفاتورة المبدئية")}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                role="tab"
                aria-selected={section === "invoice"}
                variant={section === "invoice" ? "default" : "outline"}
                onClick={() => setSection("invoice")}
              >
                <ReceiptText className="h-3.5 w-3.5" />
                <span>2. {tx("tabCommercialClean", "الفاتورة التجارية")}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                role="tab"
                aria-selected={section === "packing"}
                variant={section === "packing" ? "default" : "outline"}
                onClick={() => setSection("packing")}
              >
                <Boxes className="h-3.5 w-3.5" />
                <span>3. {tx("tabPackingClean", "بيان العبوة والحاويات")}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                role="tab"
                aria-selected={section === "preview"}
                variant={section === "preview" ? "default" : "outline"}
                onClick={() => setSection("preview")}
              >
                <Stamp className="h-3.5 w-3.5" />
                <span>4. {tx("tabPreviewClean", "المعاينة الحية والختم")}</span>
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {canManageCatalog ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setCatalogOpen(true)}>
                  {tx("tradeManageCatalog", "كتالوج الأصناف والأوزان")}
                </Button>
              ) : null}
              {canManageCompanyOrBank ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setCompanyOpen(true)}>
                  {tx("tradeCompanyDialog", "بيانات الشركة والبنك")}
                </Button>
              ) : null}
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
              onConverted={() => {
                setReady(false);
                setSection("invoice");
              }}
            />
          ) : null}

          {/* TAB 2: COMMERCIAL INVOICE */}
          {section === "invoice" ? (
            <div className="space-y-4">
              {/* 12-Column Aligned Header Form (4 Equal Columns) */}
              <div className="rounded-xl border border-line bg-paper/30 p-4">
                <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-4">
                  <Field label={tx("tradeBank", "حساب البنك المصدر")}>
                    <Select
                      className="h-10"
                      value={bankId}
                      disabled={locked}
                      onChange={(event) => setBankId(event.target.value)}
                    >
                      <option value="">{tx("tradeNoBank", "بدون حساب بنكي")}</option>
                      {(banks.data ?? []).map((bank) => (
                        <option key={bank.id} value={bank.id}>{bank.account_name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={tx("printReference", "المرجع المطبوع (كود العميل)")}>
                    <Input
                      dir="ltr"
                      className="h-10"
                      value={reference}
                      disabled={locked}
                      placeholder="EX-116"
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </Field>
                  <PaymentTermField value={paymentLabel} disabled={locked} onChange={setPaymentLabel} />
                  <ShippingMethodField value={shippingLabel} disabled={locked} onChange={setShippingLabel} />

                  <Field label={tx("originOfGoods", "بلد المنشأ")}>
                    <Input
                      dir="ltr"
                      className="h-10"
                      value={origin}
                      disabled={locked}
                      onChange={(event) => setOrigin(event.target.value)}
                    />
                  </Field>
                  <Field label={tx("portOfLoading", "ميناء الشحن")}>
                    <Input
                      dir="ltr"
                      className="h-10"
                      value={portLoading}
                      disabled={locked}
                      onChange={(event) => setPortLoading(event.target.value)}
                    />
                  </Field>
                  <Field label={tx("portOfDischarge", "ميناء الوصول")}>
                    <Input
                      dir="ltr"
                      className="h-10"
                      value={portDischarge}
                      disabled={locked}
                      onChange={(event) => setPortDischarge(event.target.value)}
                    />
                  </Field>
                  <Field label={tx("seaFreight", "تكلفة الشحن البحري")}>
                    <Input
                      dir="ltr"
                      className="h-10"
                      value={freight}
                      disabled={locked}
                      onChange={(event) => setFreight(event.target.value)}
                    />
                  </Field>

                  <div className="border-t border-line/60 pt-2.5 md:col-span-4">
                    <PaymentPresetStrip value={paymentLabel} disabled={locked} onChange={setPaymentLabel} />
                  </div>
                </div>
              </div>

              {/* True Spreadsheet Table UI for Commercial Invoice Items */}
              <div className="overflow-hidden rounded-xl border border-line bg-card shadow-sm">
                {/* Table Top Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/60 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink">
                      {tx("commercialItemsTableTitle", "جدول بنود الفاتورة التجارية")}
                    </span>
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                      {lines.length} {tx("itemsCountLabel", "بنود")}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value=""
                      disabled={locked}
                      className="h-9 w-60 text-xs"
                      onChange={(event) => {
                        insertPresetToInvoice(event.target.value);
                        event.target.value = "";
                      }}
                    >
                      <option value="">{tx("tradeChoosePreset", "+ إدراج صنف سريع من الكتالوج...")}</option>
                      {(presets.data ?? []).map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={locked}
                      onClick={() => setLines((current) => [...current, blankInvoiceLine()])}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {tx("tradeAddLine", "إضافة بند فاتورة")}
                    </Button>
                  </div>
                </div>

                {/* Fixed-Style Table Header */}
                <div className="hidden border-b border-line bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:bg-slate-900/70 dark:text-slate-100 md:grid md:grid-cols-[4fr_2fr_1fr_1.5fr_1.5fr_1.5fr_auto] md:items-center md:gap-2.5">
                  <div>{tx("description", "وصف الصنف (Description)")}</div>
                  <div>{tx("hsAndBarcode", "البند الجمركي / الباركود")}</div>
                  <div className="text-center">{tx("unit", "الوحدة")}</div>
                  <div className="text-center">{tx("quantity", "الكمية (QTY)")}</div>
                  <div className="text-center">{tx("price", "سعر الوحدة")}</div>
                  <div className="text-end">{tx("amount", "إجمالي السطر")}</div>
                  <div className="w-24 text-center">{tx("actions", "إجراءات")}</div>
                </div>

                {/* Spreadsheet Rows */}
                <div className="divide-y divide-line/70">
                  {lines.map((line, idx) => (
                    <div
                      key={line.key}
                      className="grid grid-cols-1 items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-paper/40 md:grid-cols-[4fr_2fr_1fr_1.5fr_1.5fr_1.5fr_auto]"
                    >
                      {/* Col 1 (4 cols): Item Description */}
                      <div className="flex items-start gap-2">
                        <span className="mt-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper text-[11px] font-semibold text-ink-muted tabular-nums">
                          {idx + 1}
                        </span>
                        <Textarea
                          rows={2}
                          className="min-h-[60px] resize-y py-1.5 text-xs leading-relaxed"
                          placeholder={tx("descriptionPlaceholder", "وصف البطانية أو المنسوجات، عدد الطبقات، الخامة، المقاس...")}
                          value={line.description}
                          disabled={locked}
                          onChange={(event) => updateLine(setLines, line.key, { description: event.target.value })}
                        />
                      </div>

                      {/* Col 2 (2 cols): HS Code + Barcode */}
                      <div className="grid gap-1.5">
                        <Input
                          dir="ltr"
                          placeholder="HS Code *"
                          value={line.hsCode}
                          disabled={locked}
                          className={cn("h-7 px-2 text-xs font-mono", line.hsCode.trim() ? "" : "border-danger/60")}
                          onChange={(event) => updateLine(setLines, line.key, { hsCode: event.target.value })}
                        />
                        <Input
                          dir="ltr"
                          placeholder="Barcode"
                          value={line.barcode}
                          disabled={locked}
                          className="h-7 px-2 text-xs font-mono"
                          onChange={(event) => updateLine(setLines, line.key, { barcode: event.target.value })}
                        />
                      </div>

                      {/* Col 3 (1 col): Unit */}
                      <div>
                        <Input
                          className="h-9 px-2 text-center text-xs"
                          value={line.unit}
                          disabled={locked}
                          onChange={(event) => updateLine(setLines, line.key, { unit: event.target.value })}
                        />
                      </div>

                      {/* Col 4 (1.5 cols): QTY */}
                      <div>
                        <Input
                          dir="ltr"
                          inputMode="numeric"
                          className="h-9 px-2.5 text-center text-xs font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          value={line.quantity}
                          disabled={locked}
                          onChange={(event) => updateLine(setLines, line.key, { quantity: event.target.value })}
                        />
                      </div>

                      {/* Col 5 (1.5 cols): Unit Price */}
                      <div>
                        <Input
                          dir="ltr"
                          inputMode="decimal"
                          className="h-9 px-2.5 text-center text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          value={line.price}
                          disabled={locked}
                          onChange={(event) => updateLine(setLines, line.key, { price: event.target.value })}
                        />
                      </div>

                      {/* Col 6 (1.5 cols): Line Amount */}
                      <div
                        className="flex h-9 items-center justify-end rounded-control border border-line/60 bg-paper/60 px-2.5 text-xs font-bold tabular-nums text-ink"
                        dir="ltr"
                      >
                        {moneyText(lineAmount(line, currency), currency)} {currency}
                      </div>

                      {/* Col 7 (0.5 col): Icon Actions */}
                      <div className="flex h-9 w-24 items-center justify-center gap-1">
                        <button
                          type="button"
                          disabled={locked}
                          title={tx("tradeCopyLine", "نسخ السطر")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-ink-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                          onClick={() => setLines((current) => [...current, { ...line, key: newKey() }])}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={locked || !canManageCatalog || !line.description.trim()}
                          title={tx("tradeSaveLineCatalog", "حفظ في الكتالوج")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-ink-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                          onClick={() =>
                            void saveLineToCatalog(line)
                              .then(() => {
                                notifySuccess(tx("tradePresetSaved", "تم حفظ الصنف في الكتالوج"));
                                return client.invalidateQueries({ queryKey: ["product-presets"] });
                              })
                              .catch(notifyError)
                          }
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={locked}
                          title={tx("tradeRemoveLine", "حذف البند")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-danger/80 transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                          onClick={() =>
                            setLines((current) =>
                              current.length === 1 ? [blankInvoiceLine()] : current.filter((item) => item.key !== line.key),
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 3-Cell Financial Totals Footer */}
                <div className="grid grid-cols-1 divide-y divide-line border-t border-line bg-slate-100/80 text-slate-800 dark:bg-slate-900/60 dark:text-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0 md:divide-x-reverse">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs font-medium text-ink-muted">{tx("fobTotalLabel", "إجمالي البضاعة (FOB)")}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink" dir="ltr">
                      {moneyText(fob, currency)} {currency}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs font-medium text-ink-muted">
                      {tx("seaFreightTotalLabel", "الشحن البحري (Freight)")}
                      {!chargesFreight ? <span className="ms-1 text-[11px] opacity-75">(غير مضاف على {shippingLabel})</span> : null}
                    </span>
                    <span className={cn("text-sm font-semibold tabular-nums", chargesFreight ? "text-ink" : "text-ink-muted")} dir="ltr">
                      {moneyText(effectiveFreightMinor, currency)} {currency}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-accent/[0.08] px-4 py-3">
                    <span className="text-xs font-bold text-ink">{tx("grandTotalLabel", `الإجمالي النهائي (${shippingLabel})`)}</span>
                    <span className="text-base font-bold tabular-nums text-accent" dir="ltr">
                      {moneyText(grandTotalMinor, currency)} {currency}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 3: PACKING LIST & CONTAINERS */}
          {section === "packing" ? (
            <div className="space-y-4">
              {/* Single Clean Top Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper/60 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Container className="h-4 w-4 text-accent" />
                  <span className="text-xs font-semibold text-ink">
                    {tx("containerCentricPackingTitle", "إدارة حاويات العملية وتفصيل بيان العبوة")}
                  </span>
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                    {liveContainers.length} {tx("containersCountLabel", "حاويات مسجلة")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {effectiveCaseId ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        dir="ltr"
                        className="h-9 w-40 text-xs font-mono"
                        placeholder="MRSU5942500 (اختياري)"
                        value={newContainerNumber}
                        disabled={locked || busy}
                        onChange={(e) => setNewContainerNumber(e.target.value)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={locked || busy}
                        onClick={() => void addContainerToOperation()}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {tx("addContainerToCase", "إضافة حاوية للعملية")}
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
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    {tx("tradeDraftFromInvoice", "توليد من بنود الفاتورة")}
                  </Button>
                </div>
              </div>

              {/* Container Cards */}
              <div className="space-y-4">
                {groupedContainers.map((group, groupIndex) => {
                  const containerObj = liveContainers.find((c) => c.id === group.containerId);
                  const containerTitle = group.containerId
                    ? `${tx("container", "الحاوية")} #${group.slotIndex ?? groupIndex + 1}`
                    : tx("unassignedContainerBlock", "بنود غير مربوطة بحاوية");
                  const editNum = containerObj ? (containerNumberEdits[containerObj.id] ?? containerObj.official_number ?? "") : "";

                  return (
                    <div
                      key={group.containerId ?? "unassigned"}
                      className="overflow-hidden rounded-xl border border-line bg-card shadow-sm"
                      data-container-block={group.containerId ?? "unassigned"}
                    >
                      {/* Container Card Header (2 Organized Rows) */}
                      <div className="space-y-2.5 border-b border-line bg-slate-50/90 px-4 py-3 dark:bg-slate-900/50">
                        {/* Row 1: Container Name + Official Number Input + 4 Summary Chips */}
                        <div className="flex flex-wrap items-center justify-between gap-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">
                              <Container className="h-3.5 w-3.5" />
                              <span>{containerTitle}</span>
                              {group.officialNumber ? (
                                <span className="font-mono text-ink" dir="ltr">({group.officialNumber})</span>
                              ) : null}
                            </span>

                            {containerObj && !locked ? (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  dir="ltr"
                                  className="h-8 w-40 px-2.5 text-xs font-mono"
                                  placeholder="رقم الحاوية الرسمي..."
                                  value={editNum}
                                  onChange={(e) =>
                                    setContainerNumberEdits((cur) => ({ ...cur, [containerObj.id]: e.target.value }))
                                  }
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2.5 text-xs"
                                  disabled={busy || !editNum.trim()}
                                  onClick={() => void saveContainerNumber(containerObj)}
                                >
                                  {tx("saveShort", "حفظ الرقم")}
                                </Button>
                              </div>
                            ) : null}
                          </div>

                          {/* 4 Container Summary Chips */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]" dir="ltr">
                            <span className="whitespace-nowrap rounded-md border border-line bg-card px-2.5 py-1 font-semibold text-ink shadow-2xs">
                              الطرود: <strong className="tabular-nums">{group.totals.packagesCount}</strong>
                            </span>
                            <span className="whitespace-nowrap rounded-md border border-line bg-card px-2.5 py-1 font-semibold text-ink shadow-2xs">
                              القطع: <strong className="tabular-nums">{group.totals.piecesCount}</strong>
                            </span>
                            <span className="whitespace-nowrap rounded-md border border-line bg-card px-2.5 py-1 font-semibold text-ink shadow-2xs">
                              الصافي: <strong className="tabular-nums">{kgText(group.totals.netWeightGrams)} kg</strong>
                            </span>
                            <span className="whitespace-nowrap rounded-md border border-accent/35 bg-accent/10 px-2.5 py-1 font-bold text-accent shadow-2xs">
                              القائم: <strong className="tabular-nums">{kgText(group.totals.grossWeightGrams)} kg</strong>
                            </span>
                          </div>
                        </div>

                        {/* Row 2: Insertion Tools (Catalog Select + Add Product + Add Standalone Accessory) */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2">
                          <span className="text-[11px] font-medium text-ink-muted">
                            {tx("containerInsertToolbarHint", "إدراج أصناف أو ملحقات داخل هذه الحاوية:")}
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Select
                              value=""
                              disabled={locked}
                              className="h-8 w-56 bg-card text-xs"
                              onChange={(event) => {
                                insertPresetToPackingContainer(event.target.value, group.containerId ?? "");
                                event.target.value = "";
                              }}
                            >
                              <option value="">{tx("tradeChoosePreset", "اختر صنفاً من الكتالوج...")}</option>
                              {(presets.data ?? []).map((preset) => {
                                const netG = preset.unit_net_weight_grams ?? preset.piece_weight_grams ?? 0;
                                return (
                                  <option key={preset.id} value={preset.id}>
                                    {preset.name} ({kgText(netG)} kg)
                                  </option>
                                );
                              })}
                            </Select>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 bg-card px-2.5 text-xs"
                              disabled={locked}
                              onClick={() =>
                                setPacking((current) => [
                                  ...current,
                                  blankPackingLine(group.containerId ?? ""),
                                ])
                              }
                            >
                              + {tx("addProductShort", "بند منتج")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 bg-card px-2.5 text-xs"
                              disabled={locked}
                              onClick={() =>
                                setPacking((current) => [
                                  ...current,
                                  blankAccessoryPackingLine(group.containerId ?? ""),
                                ])
                              }
                            >
                              + {tx("addAccessoryShort", "ملحق مفرد")}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Container Items Table Header */}
                      <div className="hidden border-b border-line bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:bg-slate-900/70 dark:text-slate-100 md:grid md:grid-cols-[3.5fr_1.5fr_1fr_1fr_1fr_1.5fr_1.5fr_auto] md:items-center md:gap-2">
                        <div>{tx("description", "وصف الصنف")}</div>
                        <div>{tx("hsCode", "HS Code / الحاوية")}</div>
                        <div className="text-center">{tx("packages", "الطرود")}</div>
                        <div className="text-center">{tx("packingPerPackage", "التعبئة/طرد")}</div>
                        <div className="text-center">{tx("pieces", "إجمالي القطع")}</div>
                        <div className="text-center">{tx("netKgShort", "الوزن الصافي الكلي")}</div>
                        <div className="text-center">{tx("grossKgShort", "الوزن القائم الكلي")}</div>
                        <div className="w-20 text-center">{tx("actions", "حفظ/حذف")}</div>
                      </div>

                      {/* Container Lines */}
                      <div className="divide-y divide-line/70">
                        {group.lines.length === 0 ? (
                          <p className="py-6 text-center text-xs text-ink-muted">
                            {tx("emptyContainerLines", "لا توجد أصناف محملة في هذه الحاوية بعد. اختر من الكتالوج أو أضف بند منتج أو ملحق مفرد.")}
                          </p>
                        ) : (
                          group.lines.map(({ draft: line, calc }) => {
                            const heavy = calc.netWeightGrams > calc.grossWeightGrams;
                            const isAccessory = line.lineType === "ACCESSORY";
                            const isExpanded = Boolean(expandedWeights[line.key]);

                            return (
                              <div key={line.key} className="px-3.5 py-2.5 transition-colors hover:bg-paper/30">
                                {/* Primary Table Row */}
                                <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-[3.5fr_1.5fr_1fr_1fr_1fr_1.5fr_1.5fr_auto]">
                                  {/* Col 1: Description + Optional Accessory/Alert Badges */}
                                  <div className="space-y-1">
                                    {(isAccessory || heavy) ? (
                                      <div className="flex items-center gap-1.5">
                                        {isAccessory ? (
                                          <button
                                            type="button"
                                            disabled={locked}
                                            onClick={() =>
                                              updatePackingLine(line.key, {
                                                lineType: "PRODUCT",
                                                includePiecesInReconciliation: true,
                                              })
                                            }
                                            className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 transition-colors hover:bg-amber-200 dark:border-amber-500/35 dark:bg-amber-500/20 dark:text-amber-300"
                                            title={tx("toggleLineTypeHint", "انقر للتحويل إلى منتج أساسي")}
                                          >
                                            ملحق مفرد
                                          </button>
                                        ) : null}
                                        {heavy ? (
                                          <span className="text-[11px] font-semibold text-danger" role="alert">
                                            {tx("netAboveGrossShort", "الصافي أكبر من القائم!")}
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    <Textarea
                                      rows={2}
                                      className="min-h-[52px] resize-y py-1.5 text-xs leading-relaxed"
                                      placeholder={isAccessory ? "شنط إضافية / بوسترات / كراتين..." : "وصف البطانية / المنسوجات..."}
                                      value={line.description}
                                      disabled={locked}
                                      onChange={(event) => updatePackingLine(line.key, { description: event.target.value })}
                                    />
                                  </div>

                                  {/* Col 2: HS Code + Container Selector */}
                                  <div className="grid gap-1.5">
                                    <Input
                                      dir="ltr"
                                      placeholder="HS Code"
                                      className="h-7 px-2 text-xs font-mono"
                                      value={line.hsCode}
                                      disabled={locked}
                                      onChange={(event) => updatePackingLine(line.key, { hsCode: event.target.value })}
                                    />
                                    <Select
                                      value={line.containerId}
                                      disabled={locked}
                                      className="h-7 px-1.5 text-[11px]"
                                      onChange={(event) => updatePackingLine(line.key, { containerId: event.target.value })}
                                    >
                                      <option value="">{tx("tradeChooseContainer", "غير مربوط بحاوية")}</option>
                                      {liveContainers.map((item) => (
                                        <option key={item.id} value={item.id}>
                                          #{item.slot_index ?? ""}: {item.official_number || "بدون رقم"}
                                        </option>
                                      ))}
                                    </Select>
                                  </div>

                                  {/* Col 3: Packages Count */}
                                  <div>
                                    <Input
                                      dir="ltr"
                                      inputMode="numeric"
                                      className="h-9 px-2 text-center text-xs font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                      value={line.packages}
                                      disabled={locked}
                                      onChange={(event) => updatePackingLine(line.key, { packages: event.target.value })}
                                    />
                                  </div>

                                  {/* Col 4: Packing per Package */}
                                  <div>
                                    <Input
                                      dir="ltr"
                                      inputMode="numeric"
                                      className="h-9 px-2 text-center text-xs font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                      value={line.perPackage}
                                      disabled={locked}
                                      onChange={(event) => updatePackingLine(line.key, { perPackage: event.target.value })}
                                    />
                                  </div>

                                  {/* Col 5: Total Pieces */}
                                  <div
                                    className="flex h-9 items-center justify-center rounded-control border border-line/60 bg-paper/60 px-2 text-xs font-bold tabular-nums text-ink"
                                    dir="ltr"
                                  >
                                    {calc.piecesCount}
                                  </div>

                                  {/* Col 6: Total Net Weight (kg) */}
                                  <div>
                                    <Input
                                      dir="ltr"
                                      inputMode="decimal"
                                      className={cn(
                                        "h-9 px-2 text-center text-xs font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                                        heavy ? "border-danger text-danger" : "",
                                      )}
                                      value={line.netKg}
                                      disabled={locked || (!isAccessory && !canOverrideWeights)}
                                      onChange={(event) =>
                                        updatePackingLine(line.key, { netKg: event.target.value, manualOverride: true })
                                      }
                                    />
                                  </div>

                                  {/* Col 7: Total Gross Weight (kg) */}
                                  <div>
                                    <Input
                                      dir="ltr"
                                      inputMode="decimal"
                                      className="h-9 px-2 text-center text-xs font-bold tabular-nums text-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                      value={line.grossKg}
                                      disabled={locked || (!isAccessory && !canOverrideWeights)}
                                      onChange={(event) =>
                                        updatePackingLine(line.key, { grossKg: event.target.value, manualOverride: true })
                                      }
                                    />
                                  </div>

                                  {/* Col 8: Save to Catalog / Delete Icon Actions */}
                                  <div className="flex h-9 w-20 items-center justify-center gap-1">
                                    {!isAccessory ? (
                                      <button
                                        type="button"
                                        disabled={locked || !canManageCatalog || !line.description.trim()}
                                        title={tx("saveWeightsToCatalog", "حفظ الصنف وأوزانه بالكتالوج")}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-ink-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                                        onClick={() =>
                                          void savePackingLineToCatalog(line)
                                            .then(() => {
                                              notifySuccess(tx("tradePresetSaved", "تم حفظ الصنف وأوزانه في الكتالوج"));
                                              return client.invalidateQueries({ queryKey: ["product-presets"] });
                                            })
                                            .catch(notifyError)
                                        }
                                      >
                                        <BookmarkPlus className="h-3.5 w-3.5" />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      disabled={locked}
                                      title={tx("tradeRemoveLine", "حذف السطر")}
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-danger/80 transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                                      onClick={() =>
                                        setPacking((current) =>
                                          current.length === 1
                                            ? [blankPackingLine(group.containerId ?? "")]
                                            : current.filter((item) => item.key !== line.key),
                                        )
                                      }
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Progressive Disclosure: Compact Weight Breakdown Summary Pill */}
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleWeightPanel(line.key)}
                                    className={cn(
                                      "inline-flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                                      isExpanded
                                        ? "border-accent/50 bg-accent/10 text-ink"
                                        : "border-line/80 bg-paper/60 text-ink-muted hover:border-accent/40 hover:text-ink",
                                    )}
                                  >
                                    <Scale className="h-3.5 w-3.5 text-accent" />
                                    <span className="font-medium text-ink">وزن القطعة:</span>
                                    <span className="tabular-nums" dir="ltr">
                                      {line.unitNetKg} كجم صافي + {line.bagKg} شنطة + {line.posterKg} بوستر
                                      {safeGrams(line.otherAccessoryKg) > 0 ? ` + ${line.otherAccessoryKg} ملحق` : ""}
                                      {" = "}
                                      <strong className="text-accent">{kgText(calc.unitGrossWeightGrams)} كجم قائم</strong>
                                    </span>
                                    {line.manualOverride ? (
                                      <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                                        ميزان بسكول يدوي
                                      </span>
                                    ) : null}
                                    <span className="ms-1 inline-flex items-center gap-0.5 font-semibold text-accent">
                                      [{tx("editComponentWeights", "تعديل أوزان المكونات")}
                                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}]
                                    </span>
                                  </button>

                                  {isAccessory ? (
                                    <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
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
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={locked}
                                      onClick={() =>
                                        updatePackingLine(line.key, {
                                          lineType: "ACCESSORY",
                                          includePiecesInReconciliation: false,
                                        })
                                      }
                                      className="text-[11px] font-medium text-ink-muted transition-colors hover:text-accent hover:underline disabled:opacity-40"
                                    >
                                      {tx("convertToAccessoryShort", "تحويل لملحق مفرد")}
                                    </button>
                                  )}
                                </div>

                                {/* Collapsible Component Weight Breakdown Drawer */}
                                {isExpanded ? (
                                  <div className="mt-2 rounded-xl border border-accent/30 bg-paper/70 p-3 shadow-inner">
                                    <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-5">
                                      <Field label={tx("unitNetKg", "وزن القطعة الصافي (كجم)")}>
                                        <Input
                                          dir="ltr"
                                          inputMode="decimal"
                                          className="h-9 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                          value={line.unitNetKg}
                                          disabled={locked}
                                          onChange={(e) => updatePackingLine(line.key, { unitNetKg: e.target.value, manualOverride: false })}
                                        />
                                      </Field>
                                      <Field label={tx("bagKg", "وزن الشنطة للقطعة (كجم)")}>
                                        <Input
                                          dir="ltr"
                                          inputMode="decimal"
                                          className="h-9 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                          value={line.bagKg}
                                          disabled={locked}
                                          onChange={(e) => updatePackingLine(line.key, { bagKg: e.target.value, manualOverride: false })}
                                        />
                                      </Field>
                                      <Field label={tx("posterKg", "وزن البوستر/الكرتونة (كجم)")}>
                                        <Input
                                          dir="ltr"
                                          inputMode="decimal"
                                          className="h-9 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                          value={line.posterKg}
                                          disabled={locked}
                                          onChange={(e) => updatePackingLine(line.key, { posterKg: e.target.value, manualOverride: false })}
                                        />
                                      </Field>
                                      <Field label={tx("otherAccessoryKg", "ملحق إضافي للقطعة (كجم)")}>
                                        <Input
                                          dir="ltr"
                                          inputMode="decimal"
                                          className="h-9 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                          value={line.otherAccessoryKg}
                                          disabled={locked}
                                          onChange={(e) => updatePackingLine(line.key, { otherAccessoryKg: e.target.value, manualOverride: false })}
                                        />
                                      </Field>
                                      <Field label={tx("unitGrossKg", "إجمالي قائم القطعة (كجم)")}>
                                        <Input
                                          dir="ltr"
                                          readOnly
                                          className="h-9 bg-card text-xs font-bold tabular-nums text-accent"
                                          value={kgText(calc.unitGrossWeightGrams)}
                                        />
                                      </Field>
                                    </div>

                                    {/* Optional Named Extra Accessories */}
                                    {line.extraAccessories.length > 0 ? (
                                      <div className="mt-2.5 space-y-1.5 border-t border-line/60 pt-2.5">
                                        {line.extraAccessories.map((acc, accIdx) => (
                                          <div key={accIdx} className="flex flex-wrap items-center gap-2 text-xs">
                                            <Input
                                              className="h-8 w-48 text-xs"
                                              placeholder={tx("accessoryName", "اسم الملحق (شماعة / كيس...)")}
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
                                              className="h-8 w-28 text-xs tabular-nums"
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
                                              className="h-7 px-2"
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

                                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2.5">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        disabled={locked}
                                        onClick={() =>
                                          updatePackingLine(line.key, {
                                            extraAccessories: [...line.extraAccessories, { name: "ملحق إضافي", weightGrams: 0 }],
                                          })
                                        }
                                      >
                                        + {tx("addNamedAccessory", "إضافة ملحق مسمى للقطعة")}
                                      </Button>

                                      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                                        <input
                                          type="checkbox"
                                          checked={line.manualOverride}
                                          disabled={locked || !canOverrideWeights}
                                          onChange={(e) =>
                                            updatePackingLine(line.key, { manualOverride: e.target.checked })
                                          }
                                        />
                                        {tx("manualBasculeOverride", "تعديل الوزن الكلي يدوياً (مطابقة ميزان البسكول)")}
                                      </label>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Grand Total Packing Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3 text-sm font-semibold text-ink">
                <span>{tx("packingGrandTotal", "الإجمالي العام لبيان العبوة (جميع الحاويات)")}</span>
                <span className="tabular-nums" dir="ltr">
                  {tx("packages", "الطرود")}: {summary.packing.packages} · {tx("pieces", "القطع")}: {summary.packing.pieces} · {tx("netKg", "الصافي")}: {kgText(summary.packing.netGrams)} kg · {tx("grossKg", "القائم")}: {kgText(summary.packing.grossGrams)} kg
                </span>
              </div>
            </div>
          ) : null}

          {/* TAB 4: LIVE A4 PREVIEW & STAMP */}
          {section === "preview" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3.5 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={liveDoc === "proforma" ? "default" : "outline"}
                    onClick={() => setLiveDoc("proforma")}
                  >
                    {tx("previewProforma", "الفاتورة المبدئية")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={liveDoc === "commercial" ? "default" : "outline"}
                    onClick={() => setLiveDoc("commercial")}
                  >
                    {tx("tradeLiveInvoice", "الفاتورة التجارية")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={liveDoc === "packing" ? "default" : "outline"}
                    onClick={() => setLiveDoc("packing")}
                  >
                    {tx("tradeLivePacking", "بيان العبوة")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={liveDoc === "customs" ? "default" : "outline"}
                    onClick={() => setLiveDoc("customs")}
                  >
                    {tx("previewCustomsBundle", "الملف الجمركي المدمج")}
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
        </div>

        {/* 6. Unified Bottom Action Bar (Hidden on Tab 1 "الفاتورة المبدئية" since Proforma has its own dedicated action bar) */}
        {section !== "proforma" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-line bg-slate-50/90 p-4 dark:bg-slate-900/80">
            {/* Right Side (in RTL): Primary Actions */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Button type="button" variant="outline" disabled={locked || busy} onClick={() => void saveDraft()}>
                {tx("tradeSaveDraft", "حفظ كمسودة")}
              </Button>
              {canIssueInvoice ? (
                <Button type="button" disabled={busy} onClick={() => void issue()}>
                  <CheckCircle2 className="h-4 w-4" />
                  {tx("tradeIssue", "إصدار نهائي وإرفاق بالمستندات")}
                </Button>
              ) : null}
            </div>

            {/* Left Side (in RTL): Joined PDF Export Button Group */}
            <div
              className="inline-flex flex-wrap overflow-hidden rounded-control border border-line bg-card shadow-sm divide-x divide-x-reverse divide-line"
              role="group"
              aria-label={tx("pdfDownloadsGroup", "تصدير ملفات PDF")}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1.5 bg-card px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
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
                <FileDown className="h-3.5 w-3.5 text-accent" />
                <span>{tx("tradeDownloadInvoiceShort", "PDF الفاتورة")}</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 bg-card px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
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
                <FileDown className="h-3.5 w-3.5 text-accent" />
                <span>{tx("tradeDownloadPackingShort", "PDF بيان العبوة")}</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 bg-card px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
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
                <FileDown className="h-3.5 w-3.5 text-accent" />
                <span>{tx("tradeDownloadCustomsShort", "PDF الجمارك المدمج")}</span>
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <CompanyDialog open={companyOpen} onClose={() => setCompanyOpen(false)} />
      <CatalogDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} />
    </div>
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
  const fmt = (n: number, isWeight = false) =>
    isWeight ? Number(n.toFixed(3)).toString() : String(Math.round(n));

  const cells = [
    {
      key: "pieces",
      title: tx("pieces", "القطع (Pieces)"),
      inv: fmt(summary.invoice.pieces),
      pack: fmt(summary.packing.pieces),
      diff: summary.differences.pieces,
      diffLabel: fmt(summary.differences.pieces),
    },
    {
      key: "packages",
      title: tx("packages", "الطرود (Packages)"),
      inv: fmt(summary.invoice.packages),
      pack: fmt(summary.packing.packages),
      diff: summary.differences.packages,
      diffLabel: fmt(summary.differences.packages),
    },
    {
      key: "gross",
      title: tx("grossKg", "الوزن القائم (Gross kg)"),
      inv: fmt(summary.invoice.grossGrams / 1000, true),
      pack: fmt(summary.packing.grossGrams / 1000, true),
      diff: summary.differences.grossGrams,
      diffLabel: fmt(summary.differences.grossGrams / 1000, true),
    },
    {
      key: "net",
      title: tx("netKg", "الوزن الصافي (Net kg)"),
      inv: fmt(summary.invoice.netGrams / 1000, true),
      pack: fmt(summary.packing.netGrams / 1000, true),
      diff: summary.differences.netGrams,
      diffLabel: fmt(summary.differences.netGrams / 1000, true),
    },
  ] as const;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2.5 rounded-xl border p-3 lg:grid-cols-5",
        summary.matched
          ? "border-emerald-300/80 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/[0.04]"
          : "border-amber-300/80 bg-amber-50/60 dark:border-amber-500/35 dark:bg-amber-500/[0.05]",
      )}
      role="status"
    >
      {cells.map((cell) => {
        const matched = cell.diff === 0;
        return (
          <div
            key={cell.key}
            className="flex flex-col justify-between rounded-lg border border-line/80 bg-card px-3 py-2 shadow-2xs"
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="truncate text-[11px] font-semibold text-ink-muted">{cell.title}</span>
              <span
                className={cn(
                  "whitespace-nowrap shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums",
                  matched
                    ? "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/20 dark:text-amber-300",
                )}
              >
                {matched ? "متطابق ✓" : `فرق: ${cell.diff > 0 ? "+" : ""}${cell.diffLabel}`}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums">
              <span className="text-ink-muted">
                الفاتورة: <strong className="font-semibold text-ink" dir="ltr">{cell.inv}</strong>
              </span>
              <span className="text-line">|</span>
              <span className="text-ink-muted">
                البيان: <strong className="font-semibold text-ink" dir="ltr">{cell.pack}</strong>
              </span>
            </div>
          </div>
        );
      })}

      {/* 5th Column: Sync Button */}
      <div className="flex flex-col justify-center">
        <Button
          type="button"
          size="sm"
          variant={summary.matched ? "outline" : "default"}
          className="h-full min-h-11 w-full gap-1.5 text-xs font-semibold"
          disabled={locked || busy}
          onClick={onSync}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy ? "animate-spin" : "")} />
          <span>{tx("tradeSyncShort", "مزامنة مع بيان العبوة")}</span>
        </Button>
      </div>
    </div>
  );
}

function blankInvoiceLine(): InvoiceDraftLine {
  return { key: newKey(), description: "", hsCode: "", barcode: "", unit: "Piece", quantity: "1", price: "0.00" };
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
    unit: line.unit_label ?? "Piece",
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
