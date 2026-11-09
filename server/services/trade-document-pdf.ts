/**
 * Trade-document PDF renderer. Money and weights arrive already calculated.
 * Latin text uses Helvetica. Arabic uses the same baked outlines as quotations.
 * JPEG and PNG bytes, when present, are embedded. A missing stamp image becomes
 * a vector approval box. Draft pages carry a watermark; issued pages do not.
 */
import { paintTradeBlock, paintTradeLine, tradeLineCount } from "./quotation-pdf";
import { TRADE_PAGE_H, TRADE_PAGE_W, TRADE_STAMP_BASE, tradeRowHeight } from "../../shared/trade-sheet";

export type TradeImage = Uint8Array | null;

export type TradeIdentity = {
  nameEn: string;
  nameAr: string;
  address: string;
  phone: string;
  email: string;
  taxCard: string;
  taxFile: string;
  commercialRegistry: string;
  stampLabelEn: string;
  stampLabelAr: string;
};

export type TradeBuyer = { name: string; address: string; vat: string; phone: string; email: string };

export type TradeBank = {
  accountName: string;
  iban: string;
  bankName: string;
  bankAddress: string;
  swift: string;
};

export type TradeItem = { description: string; unit: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number };

export type TradePackingRow = {
  slot: number | null;
  containerNumber: string;
  description: string;
  packages: number;
  perPackage: number;
  pieces: number;
  grossGrams: number;
  netGrams: number;
};

type Common = {
  draft: boolean;
  identity: TradeIdentity;
  buyer: TradeBuyer;
  date: string;
  invoiceNumber: string;
  printReference: string;
  origin: string;
  portOfLoading: string;
  portOfDischarge: string;
  shippingMethod: string;
  paymentTerm: string;
  bank: TradeBank | null;
  logo: TradeImage;
  stamp: TradeImage;
  stamped: boolean;
  stampXRatio: number;
  stampYRatio: number;
  stampScale: number;
  stampRotation: number;
  includeFreight: boolean;
};

export type ProformaPdf = Common & { kind: "proforma"; incoterm: string; lines: TradeItem[]; fobMinor: number; freightMinor: number };
export type CommercialPdf = Common & {
  kind: "commercial";
  incoterm: string;
  lines: TradeItem[];
  fobMinor: number;
  freightMinor: number;
  packages: number;
  grossGrams: number;
  netGrams: number;
};
export type PackingPdf = Common & { kind: "packing"; rows: TradePackingRow[] };
export type TradePdfModel = ProformaPdf | CommercialPdf | PackingPdf;

const PAGE_W = TRADE_PAGE_W;
const PAGE_H = TRADE_PAGE_H;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 46;

const INK = "0.06 0.09 0.16";
const HEAD = "0.12 0.16 0.23";

type ImageObj = { name: string; bytes: Uint8Array; w: number; h: number; kind: "jpeg" | "png"; png?: { data: Uint8Array; colors: number; mask?: Uint8Array } };

export async function renderTradePdf(model: TradePdfModel): Promise<Uint8Array> {
  const images = await collectImages(model.logo, placedStamp(model));
  const pages = layout(model, images);
  stampPages(pages, model.draft);
  return assemble(pages, images);
}

export async function renderCustomsBundle(commercial: CommercialPdf, packing: PackingPdf): Promise<Uint8Array> {
  const stampBytes = placedStamp(commercial) ?? placedStamp(packing);
  const images = await collectImages(commercial.logo ?? packing.logo, stampBytes);
  const pages = [...layout({ ...commercial, logo: commercial.logo, stamp: commercial.stamp }, images), ...layout(packing, images)];
  stampPages(pages, commercial.draft || packing.draft);
  return assemble(pages, images);
}

class Page {
  ops: string[] = [];
  y = PAGE_H - 18;
}

function layout(model: TradePdfModel, images: ImageObj[]): Page[] {
  const pages: Page[] = [];
  const cursor = { page: new Page() };
  pages.push(cursor.page);
  const fresh = () => {
    cursor.page = new Page();
    pages.push(cursor.page);
    paintHeader(cursor.page, model, images);
  };
  paintHeader(cursor.page, model, images);
  if (model.kind === "packing") paintPacking(cursor, model, fresh);
  else paintItems(cursor, model, fresh);
  paintFooter(cursor, model, fresh);
  paintPlacedStamp(pages[0], model, images);
  return pages;
}

function paintHeader(page: Page, model: TradePdfModel, images: ImageObj[]) {
  page.y = PAGE_H - 22;
  const logo = images.find((image) => image.name === "ImLogo");
  if (logo) drawImage(page.ops, logo.name, MARGIN, page.y - 34, 52, 34);
  text(page.ops, model.identity.nameEn || "Exporter", logo ? MARGIN + 60 : MARGIN, page.y - 4, 15, "left");
  if (model.identity.nameAr) text(page.ops, model.identity.nameAr, PAGE_W - MARGIN, page.y - 2, 12, "right");
  page.y -= 22;
  page.y = block(page.ops, `FACTORY ADDRESS  ${dash(model.identity.address)}`, MARGIN, page.y, 8, CONTENT_W, "left") - 4;
  text(page.ops, `Tel ${dash(model.identity.phone)}    Email ${dash(model.identity.email)}`, MARGIN, page.y, 8, "left");
  page.y -= 12;
  page.y = block(
    page.ops,
    `TAX CARD ${dash(model.identity.taxCard)}    TAX FILE ${dash(model.identity.taxFile)}    COMMERCIAL REGISTRY ${dash(model.identity.commercialRegistry)}`,
    MARGIN,
    page.y,
    7.5,
    CONTENT_W,
    "left",
  ) - 8;
  ink(page.ops);
  page.ops.push(`0.8 w ${n(MARGIN)} ${n(page.y)} m ${n(PAGE_W - MARGIN)} ${n(page.y)} l S`);
  page.y -= 8;
  const title = model.kind === "proforma" ? "PROFORMA INVOICE" : model.kind === "commercial" ? "COMMERCIAL INVOICE" : "PACKING LIST";
  const barTop = page.y;
  page.ops.push(`${HEAD} rg`, `${n(MARGIN)} ${n(barTop - 20)} ${n(CONTENT_W)} 20 re f`, "1 1 1 rg", "1 1 1 RG");
  paintTradeLine(page.ops, title, PAGE_W / 2, barTop - 15, 12, "center");
  ink(page.ops);
  page.y = barTop - 26;
  paintKvTable(page, [
    ["DATE", dash(model.date)],
    ["INVOICE NO#", dash(model.invoiceNumber)],
    ["REFERENCE", dash(model.printReference)],
  ]);
  page.y -= 8;
  text(page.ops, "BILL TO", MARGIN, page.y, 8, "left");
  page.y -= 12;
  const buyerRows: Array<[string, string]> = [
    ["CUSTOMER", dash(model.buyer.name)],
    ["ADDRESS", dash(model.buyer.address)],
    ["REGISTRATION / VAT", dash(model.buyer.vat)],
  ];
  if (model.kind !== "proforma" && model.buyer.phone) buyerRows.push(["TEL", model.buyer.phone]);
  if (model.kind !== "proforma" && model.buyer.email) buyerRows.push(["EMAIL", model.buyer.email]);
  paintKvTable(page, buyerRows);
  page.y -= 8;
}

function paintItems(cursor: { page: Page }, model: ProformaPdf | CommercialPdf, fresh: () => void) {
  const columns = itemColumns();
  const header = () => paintTableHeader(cursor.page, columns.map((column) => column.label));
  header();
  model.lines.forEach((line, index) => {
    const size = 8;
    const lines = Math.max(1, tradeLineCount(line.description, size, columns[1].w - 12));
    const height = tradeRowHeight(lines, size);
    if (cursor.page.y - height < BOTTOM + 8) {
      fresh();
      header();
    }
    const page = cursor.page;
    const top = page.y;
    const base = top - 6 - size;
    boxRow(page.ops, top, height, columns.map((column) => column.w));
    text(page.ops, String(index + 1), columns[0].x + columns[0].w / 2, base, size, "center");
    block(page.ops, line.description, columns[1].x + 6, base, size, columns[1].w - 12, "left");
    text(page.ops, line.unit || "—", columns[2].x + columns[2].w - 6, base, size, "right");
    text(page.ops, String(line.quantity), columns[3].x + columns[3].w - 6, base, size, "right");
    text(page.ops, money(line.unitPriceMinor), columns[4].x + columns[4].w - 6, base, size, "right");
    text(page.ops, money(line.lineTotalMinor), columns[5].x + columns[5].w - 6, base, size, "right");
    page.y = top - height;
  });
  let page = cursor.page;
  const showFreight = model.includeFreight;
  const totals: [string, number][] = [["TOTAL F.O.B", model.fobMinor]];
  if (showFreight) {
    totals.push(["SEA FREIGHT", model.freightMinor]);
    totals.push([model.shippingMethod.toUpperCase().includes("C&F") || model.shippingMethod.toUpperCase().includes("CFR") ? "TOTAL C&F / CFR" : "TOTAL CFR", model.fobMinor + model.freightMinor]);
  }
  for (const [label, amount] of totals) {
    if (cursor.page.y < BOTTOM + 22) fresh();
    page = cursor.page;
    const height = tradeRowHeight(1, 9);
    const top = page.y;
    boxRow(page.ops, top, height, [CONTENT_W - 120, 120]);
    text(page.ops, label, MARGIN + CONTENT_W - 126, top - 15, 9, "right");
    text(page.ops, money(amount), PAGE_W - MARGIN - 6, top - 15, 9, "right");
    page.y = top - height;
  }
  if (model.kind === "commercial") {
    paintKvTable(cursor.page, [
      ["GROSS WEIGHT", `${kg(model.grossGrams)} KG`],
      ["NET WEIGHT", `${kg(model.netGrams)} KG`],
      ["PACKAGES", String(model.packages)],
    ]);
  }
}

function paintPacking(cursor: { page: Page }, model: PackingPdf, fresh: () => void) {
  const columns = packingColumns();
  const header = () => paintTableHeader(cursor.page, columns.map((column) => column.label));
  header();
  let packages = 0;
  let pieces = 0;
  let gross = 0;
  let net = 0;
  model.rows.forEach((row, index) => {
    packages += row.packages;
    pieces += row.pieces;
    gross += row.grossGrams;
    net += row.netGrams;
    const size = 7.5;
    const lines = Math.max(1, tradeLineCount(row.description, size, columns[2].w - 12));
    const height = tradeRowHeight(lines, size);
    if (cursor.page.y - height < BOTTOM + 8) {
      fresh();
      header();
    }
    const page = cursor.page;
    const top = page.y;
    const base = top - 6 - size;
    boxRow(page.ops, top, height, columns.map((column) => column.w));
    const values = [
      String(row.slot ?? index + 1),
      row.containerNumber || "—",
      row.description,
      String(row.packages),
      String(row.perPackage),
      String(row.pieces),
      kg(row.grossGrams),
      kg(row.netGrams),
    ];
    values.forEach((value, column) => {
      if (column === 2) block(page.ops, value, columns[column].x + 6, base, size, columns[column].w - 12, "left");
      else text(page.ops, value, columns[column].x + columns[column].w - 6, base, size, column === 0 ? "center" : "right");
    });
    page.y = top - height;
  });
  if (cursor.page.y < BOTTOM + 16) fresh();
  cursor.page.y -= 16;
  const page = cursor.page;
  text(page.ops, `TOTAL    Packages ${packages}    Pieces ${pieces}    Gross ${kg(gross)} KG    Net ${kg(net)} KG`, PAGE_W - MARGIN, page.y, 8.5, "right");
}

function paintFooter(cursor: { page: Page }, model: TradePdfModel, fresh: () => void) {
  const needed = 8 * tradeRowHeight(1, 8);
  if (cursor.page.y < BOTTOM + needed) fresh();
  cursor.page.y -= 8;
  paintKvTable(cursor.page, [
    ["ORIGIN OF GOODS", dash(model.origin)],
    ["PORT OF LOADING", dash(model.portOfLoading)],
    ["PORT OF DISCHARGE", dash(model.portOfDischarge)],
    ["SHIPPING METHOD", dash(model.shippingMethod)],
    ["PAYMENT TERM", dash(model.paymentTerm)],
  ]);
  if (model.kind !== "packing" && model.bank) {
    cursor.page.y -= 8;
    text(cursor.page.ops, "BANK DETAILS", MARGIN, cursor.page.y, 8, "left");
    cursor.page.y -= 12;
    paintKvTable(cursor.page, [
      ["ACCOUNT NAME", model.bank.accountName || "—"],
      ["ACCOUNT NUMBER (IBAN)", model.bank.iban || "—"],
      ["BANK NAME", model.bank.bankName || "—"],
      ["BANK ADDRESS", model.bank.bankAddress || "—"],
      ["SWIFT CODE", model.bank.swift || "—"],
    ]);
  }
}

function paintKvTable(page: Page, rows: Array<[string, string]>) {
  const labelW = 148;
  const valueW = CONTENT_W - labelW;
  for (const [label, value] of rows) {
    const lines = Math.max(1, tradeLineCount(value || "—", 8, valueW - 12));
    const height = tradeRowHeight(lines, 8);
    const top = page.y;
    boxRow(page.ops, top, height, [labelW, valueW]);
    const base = top - 6 - 8;
    text(page.ops, label, MARGIN + 6, base, 8, "left");
    block(page.ops, value || "—", MARGIN + labelW + 6, base, 8, valueW - 12, "left");
    page.y = top - height;
  }
}

function paintPlacedStamp(page: Page, model: TradePdfModel, images: ImageObj[]) {
  const stamp = images.find((image) => image.name === "ImStamp");
  if (!model.stamped || !stamp) return;
  const width = TRADE_STAMP_BASE * (model.stampScale || 1);
  const height = Math.max(28, (stamp.h / Math.max(stamp.w, 1)) * width);
  drawStamp(page.ops, stamp.name, model.stampXRatio * PAGE_W, model.stampYRatio * PAGE_H, width, height, model.stampRotation);
}

function paintTableHeader(page: Page, labels: string[]) {
  const columns = labels.length === 6 ? itemColumns() : packingColumns();
  const widths = columns.map((column) => column.w);
  page.ops.push(`${HEAD} rg`, `${n(MARGIN)} ${n(page.y - 16)} ${n(CONTENT_W)} 16 re f`);
  page.ops.push("1 1 1 rg", "1 1 1 RG");
  labels.forEach((label, index) => {
    paintTradeLine(page.ops, label, columns[index].x + 2, page.y - 11, 6.5, "left");
  });
  boxRow(page.ops, page.y, 16, widths);
  page.y -= 16;
}

function itemColumns() {
  const widths = [28, 247.28, 52, 46, 78, 88];
  return columns(widths, ["NO", "DESCRIPTION", "UNIT", "QTY", "PRICE", "AMOUNT"]);
}

function packingColumns() {
  const widths = [24, 78, 149.28, 46, 62, 42, 70, 68];
  return columns(widths, ["NO", "CONTAINER NO", "ITEM NAME", "Package", "Per pack", "Piece", "GROSS KG", "NET KG"]);
}

function columns(widths: number[], labels: string[]) {
  let x = MARGIN;
  return widths.map((w, index) => {
    const column = { x, w, label: labels[index] };
    x += w;
    return column;
  });
}

function stampPages(pages: Page[], draft: boolean) {
  const total = pages.length;
  pages.forEach((page, index) => {
    const label = `Page ${index + 1} of ${total}`;
    page.ops.push(`${INK} RG`, `0.6 w ${n(MARGIN)} 36 m ${n(PAGE_W - MARGIN)} 36 l S`);
    text(page.ops, label, PAGE_W - MARGIN, 24, 8, "right");
    if (draft) {
      page.ops.push("q", "0.75 0.78 0.82 rg", "0.75 0.78 0.82 RG", `q 0.866 -0.5 0.5 0.866 ${n(PAGE_W / 2 - 90)} ${n(PAGE_H / 2)} cm`);
      paintTradeLine(page.ops, "DRAFT / مسودة", 0, 0, 28, "left");
      page.ops.push("Q", "Q");
      ink(page.ops);
    }
  });
}

function placedStamp(model: TradePdfModel) {
  return model.stamped ? model.stamp : null;
}

function money(minor: number) {
  const abs = Math.abs(Math.round(minor));
  return `${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

function kg(grams: number) {
  return (grams / 1000).toFixed(3);
}

function dash(value: string) {
  return value?.trim() ? value.trim() : "—";
}

function ink(ops: string[]) {
  ops.push(`${INK} rg`, `${INK} RG`);
}

function text(ops: string[], value: string, x: number, y: number, size: number, align: "left" | "right" | "center") {
  ink(ops);
  paintTradeLine(ops, value, x, y, size, align);
}

function block(ops: string[], value: string, x: number, y: number, size: number, maxWidth: number, align: "left" | "right") {
  ink(ops);
  return paintTradeBlock(ops, value, x, y, size, maxWidth, align);
}

function boxRow(ops: string[], top: number, height: number, widths: number[]) {
  const total = widths.reduce((sum, width) => sum + width, 0);
  ops.push(`${INK} RG`, `0.7 w ${n(MARGIN)} ${n(top - height)} ${n(total)} ${n(height)} re S`);
  let x = MARGIN;
  for (const width of widths.slice(0, -1)) {
    x += width;
    ops.push(`${n(x)} ${n(top)} m ${n(x)} ${n(top - height)} l S`);
  }
  ink(ops);
}

function drawImage(ops: string[], name: string, x: number, y: number, w: number, h: number) {
  ops.push("q", `${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm`, `/${name} Do`, "Q");
}

function drawStamp(ops: string[], name: string, centerX: number, centerY: number, w: number, h: number, rotation: number) {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  ops.push(
    "q",
    `${n(w)} 0 0 ${n(h)} 0 0 cm`,
    `1 0 0 1 ${n(-w / 2)} ${n(-h / 2)} cm`,
    `${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} 0 0 cm`,
    `1 0 0 1 ${n(centerX)} ${n(centerY)} cm`,
    `/${name} Do`,
    "Q",
  );
}

function n(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

async function collectImages(logo: TradeImage, stamp: TradeImage): Promise<ImageObj[]> {
  const images: ImageObj[] = [];
  const logoInfo = logo ? await describeImage(logo) : null;
  const stampInfo = stamp ? await describeImage(stamp) : null;
  if (logoInfo) images.push({ ...logoInfo, name: "ImLogo" });
  if (stampInfo) images.push({ ...stampInfo, name: "ImStamp" });
  return images;
}

async function describeImage(bytes: Uint8Array): Promise<Omit<ImageObj, "name"> | null> {
  const jpeg = jpegSize(bytes);
  if (jpeg) return { bytes, w: jpeg.w, h: jpeg.h, kind: "jpeg" };
  return pngImage(bytes);
}

function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    const size = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + size;
  }
  return null;
}

async function pngImage(bytes: Uint8Array): Promise<Omit<ImageObj, "name"> | null> {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const w = read32(bytes, 16);
  const h = read32(bytes, 20);
  const bit = bytes[24];
  const color = bytes[25];
  if (bit !== 8 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) return null;
  const colors = color === 2 ? 3 : color === 6 ? 4 : color === 0 ? 1 : 0;
  if (!colors || !w || !h) return null;
  const idat = pngIdat(bytes);
  if (!idat) return null;
  const inflated = await inflate(idat);
  if (!inflated) return null;
  const raw = unfilterPng(inflated, w, h, colors);
  if (!raw) return null;
  if (colors === 4) {
    const split = splitRgba(raw, w, h);
    return { bytes: split.rgb, w, h, kind: "png", png: { data: split.rgb, colors: 3, mask: split.alpha } };
  }
  return { bytes: raw, w, h, kind: "png", png: { data: raw, colors } };
}

function pngIdat(bytes: Uint8Array) {
  const parts: Uint8Array[] = [];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const length = read32(bytes, i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const start = i + 8;
    if (type === "IDAT") parts.push(bytes.slice(start, start + length));
    if (type === "IEND") break;
    i = start + length + 4;
  }
  if (!parts.length) return null;
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function unfilterPng(data: Uint8Array, w: number, h: number, colors: number) {
  const stride = w * colors;
  const out = new Uint8Array(stride * h);
  let src = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = data[src];
    src += 1;
    const row = src;
    if (row + stride > data.length) return null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= colors ? out[y * stride + x - colors] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= colors ? out[(y - 1) * stride + x - colors] : 0;
      const raw = data[row + x];
      out[y * stride + x] = filter === 0 ? raw : filter === 1 ? (raw + left) & 255 : filter === 2 ? (raw + up) & 255 : filter === 3 ? (raw + Math.floor((left + up) / 2)) & 255 : filter === 4 ? (raw + paeth(left, up, ul)) & 255 : raw;
    }
    src += stride;
  }
  return out;
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function splitRgba(data: Uint8Array, w: number, h: number) {
  const rgb = new Uint8Array(w * h * 3);
  const alpha = new Uint8Array(w * h);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    rgb[pixel * 3] = data[i];
    rgb[pixel * 3 + 1] = data[i + 1];
    rgb[pixel * 3 + 2] = data[i + 2];
    alpha[pixel] = data[i + 3];
  }
  return { rgb, alpha };
}

async function inflate(bytes: Uint8Array) {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function read32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function assemble(pages: Page[], images: ImageObj[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const offsets: number[] = [];
  const pushText = (text: string) => {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    pos += bytes.length;
  };
  const objStart = (id: number) => {
    offsets[id] = pos;
    pushText(`${id} 0 obj\n`);
  };
  const objEnd = () => pushText("\nendobj\n");
  pushText("%PDF-1.4\n%\xE2\xE3\xCB\xD3\n");
  const slots: Array<{ image: ImageObj; id: number; maskId?: number }> = [];
  let nextId = 4;
  for (const image of images) {
    const mask = image.png?.mask;
    const maskId = mask ? nextId++ : undefined;
    slots.push({ image, id: nextId++, maskId });
  }
  const pageStart = nextId;
  objStart(1);
  pushText("<< /Type /Catalog /Pages 2 0 R >>");
  objEnd();
  const kids = pages.map((_, index) => `${pageStart + index * 2} 0 R`).join(" ");
  objStart(2);
  pushText(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objEnd();
  objStart(3);
  pushText("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objEnd();
  for (const slot of slots) {
    const image = slot.image;
    if (slot.maskId && image.png?.mask) {
      objStart(slot.maskId);
      pushText(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.png.mask.length} >>\nstream\n`);
      pushBytes(image.png.mask);
      pushText("\nendstream");
      objEnd();
    }
    objStart(slot.id);
    if (image.kind === "jpeg") {
      pushText(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`);
      pushBytes(image.bytes);
      pushText("\nendstream");
    } else {
      const data = image.png?.data ?? image.bytes;
      const space = (image.png?.colors ?? 3) === 1 ? "/DeviceGray" : "/DeviceRGB";
      const mask = slot.maskId ? ` /SMask ${slot.maskId} 0 R` : "";
      pushText(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace ${space} /BitsPerComponent 8${mask} /Length ${data.length} >>\nstream\n`);
      pushBytes(data);
      pushText("\nendstream");
    }
    objEnd();
  }
  const xobjects = slots.map((slot) => `/${slot.image.name} ${slot.id} 0 R`).join(" ");
  pages.forEach((page, index) => {
    const pageId = pageStart + index * 2;
    const contentId = pageId + 1;
    const stream = page.ops.join("\n");
    const streamBytes = new Uint8Array(stream.length);
    for (let i = 0; i < stream.length; i += 1) streamBytes[i] = stream.charCodeAt(i) & 0xff;
    objStart(pageId);
    pushText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects} >> >> /Contents ${contentId} 0 R >>`);
    objEnd();
    objStart(contentId);
    pushText(`<< /Length ${streamBytes.length} >>\nstream\n`);
    pushBytes(streamBytes);
    pushText("\nendstream");
    objEnd();
  });
  const size = pageStart + pages.length * 2;
  const xrefAt = pos;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  pushText(xref);
  pushText(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
