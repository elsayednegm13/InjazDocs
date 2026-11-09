/**
 * Trade-document PDF renderer. Money and weights arrive already calculated.
 * Latin text uses Helvetica. Arabic uses the same baked outlines as quotations.
 * JPEG and PNG bytes, when present, are embedded. A missing stamp image becomes
 * a vector approval box. Draft pages carry a watermark; issued pages do not.
 */
import { paintTradeBlock, paintTradeLine, tradeLineCount } from "./quotation-pdf";

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

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 46;

const INK = "0.06 0.09 0.16";
const HEAD = "0.12 0.16 0.23";

type ImageObj = { name: string; bytes: Uint8Array; w: number; h: number; kind: "jpeg" | "png"; png?: { data: Uint8Array; colors: number } };

export async function renderTradePdf(model: TradePdfModel): Promise<Uint8Array> {
  const images = await collectImages(model.logo, model.stamp);
  const pages = layout(model, images);
  stampPages(pages, model.draft);
  return assemble(pages, images);
}

export async function renderCustomsBundle(commercial: CommercialPdf, packing: PackingPdf): Promise<Uint8Array> {
  const images = await collectImages(commercial.logo ?? packing.logo, commercial.stamp ?? packing.stamp);
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
  paintFooter(cursor, model, images, fresh);
  return pages;
}

function paintHeader(page: Page, model: TradePdfModel, images: ImageObj[]) {
  page.y = PAGE_H - 18;
  const logo = images.find((image) => image.name === "ImLogo");
  if (logo) drawImage(page.ops, logo.name, MARGIN, PAGE_H - 62, 54, 36);
  text(page.ops, model.identity.nameEn || "Exporter", logo ? MARGIN + 62 : MARGIN, PAGE_H - 30, 13, "left");
  if (model.identity.nameAr) text(page.ops, model.identity.nameAr, PAGE_W - MARGIN, PAGE_H - 30, 12, "right");
  text(page.ops, `FACTORY ADDRESS  ${dash(model.identity.address)}`, MARGIN, PAGE_H - 46, 8, "left");
  text(page.ops, `Tel ${dash(model.identity.phone)}    Email ${dash(model.identity.email)}`, MARGIN, PAGE_H - 58, 8, "left");
  text(
    page.ops,
    `TAX CARD ${dash(model.identity.taxCard)}    TAX FILE ${dash(model.identity.taxFile)}    COMMERCIAL REGISTRY ${dash(model.identity.commercialRegistry)}`,
    MARGIN,
    PAGE_H - 70,
    7.5,
    "left",
  );
  ink(page.ops);
  page.ops.push(`0.8 w ${n(MARGIN)} ${n(PAGE_H - 78)} m ${n(PAGE_W - MARGIN)} ${n(PAGE_H - 78)} l S`);
  const title = model.kind === "proforma" ? "PROFORMA INVOICE" : model.kind === "commercial" ? "COMMERCIAL INVOICE" : "PACKING LIST";
  text(page.ops, title, PAGE_W / 2, PAGE_H - 96, 14, "center");
  text(page.ops, `DATE  ${dash(model.date)}`, MARGIN, PAGE_H - 112, 8, "left");
  text(page.ops, `INVOICE NO#  ${dash(model.invoiceNumber)}`, PAGE_W - MARGIN, PAGE_H - 112, 8, "right");
  if (model.printReference) text(page.ops, model.printReference, PAGE_W - MARGIN, PAGE_H - 124, 8, "right");
  text(page.ops, "BILL TO", MARGIN, PAGE_H - 140, 8, "left");
  const buyerBottom = block(page.ops, buyerText(model), MARGIN, PAGE_H - 154, 8.5, 320, "left");
  page.y = Math.min(buyerBottom, PAGE_H - 176) - 8;
}

function buyerText(model: TradePdfModel) {
  const lines = [model.buyer.name, model.buyer.address, model.buyer.vat ? `Registration number / VAT  ${model.buyer.vat}` : ""];
  if (model.kind !== "proforma") {
    if (model.buyer.phone) lines.push(`Tel  ${model.buyer.phone}`);
    if (model.buyer.email) lines.push(`Email  ${model.buyer.email}`);
  }
  return lines.filter(Boolean).join("\n");
}

function paintItems(cursor: { page: Page }, model: ProformaPdf | CommercialPdf, fresh: () => void) {
  const columns = itemColumns();
  const header = () => paintTableHeader(cursor.page, columns.map((column) => column.label));
  header();
  model.lines.forEach((line, index) => {
    const lines = Math.max(1, tradeLineCount(line.description, 8, columns[1].w - 6));
    const height = 8 + lines * 10;
    if (cursor.page.y - height < BOTTOM + 8) {
      fresh();
      header();
    }
    const page = cursor.page;
    const top = page.y;
    boxRow(page.ops, top, height, columns.map((column) => column.w));
    text(page.ops, String(index + 1), columns[0].x + columns[0].w / 2, top - 11, 8, "center");
    block(page.ops, line.description, columns[1].x + 3, top - 11, 8, columns[1].w - 6, "left");
    text(page.ops, line.unit || "—", columns[2].x + columns[2].w - 3, top - 11, 8, "right");
    text(page.ops, String(line.quantity), columns[3].x + columns[3].w - 3, top - 11, 8, "right");
    text(page.ops, money(line.unitPriceMinor), columns[4].x + columns[4].w - 3, top - 11, 8, "right");
    text(page.ops, money(line.lineTotalMinor), columns[5].x + columns[5].w - 3, top - 11, 8, "right");
    page.y = top - height;
  });
  let page = cursor.page;
  const showFreight = chargesFreight(model.incoterm, model.shippingMethod);
  const totals: [string, number][] = [["TOTAL F.O.B", model.fobMinor]];
  if (showFreight) {
    totals.push(["SEA FREIGHT", model.freightMinor]);
    totals.push([model.shippingMethod.toUpperCase().includes("C&F") || model.shippingMethod.toUpperCase().includes("CFR") ? "TOTAL C&F / CFR" : "TOTAL CFR", model.fobMinor + model.freightMinor]);
  }
  for (const [label, amount] of totals) {
    if (cursor.page.y < BOTTOM + 18) fresh();
    page = cursor.page;
    page.y -= 16;
    boxRow(page.ops, page.y + 14, 16, [CONTENT_W - 120, 120]);
    text(page.ops, label, PAGE_W - MARGIN - 124, page.y, 9, "right");
    text(page.ops, money(amount), PAGE_W - MARGIN - 4, page.y, 9, "right");
  }
  if (model.kind === "commercial") {
    page = cursor.page;
    page.y -= 16;
    text(page.ops, `GROSS WEIGHT  ${kg(model.grossGrams)} KG`, MARGIN, page.y, 8, "left");
    page.y -= 12;
    text(page.ops, `NET WEIGHT  ${kg(model.netGrams)} KG`, MARGIN, page.y, 8, "left");
    page.y -= 12;
    text(page.ops, `PACKAGES  ${model.packages}`, MARGIN, page.y, 8, "left");
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
    const lines = Math.max(1, tradeLineCount(row.description, 7.5, columns[2].w - 4));
    const height = 8 + lines * 9;
    if (cursor.page.y - height < BOTTOM + 8) {
      fresh();
      header();
    }
    const page = cursor.page;
    const top = page.y;
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
      if (column === 2) block(page.ops, value, columns[column].x + 2, top - 10, 7.5, columns[column].w - 4, "left");
      else text(page.ops, value, columns[column].x + columns[column].w - 2, top - 10, 7.5, column === 0 ? "center" : "right");
    });
    page.y = top - height;
  });
  if (cursor.page.y < BOTTOM + 16) fresh();
  cursor.page.y -= 16;
  const page = cursor.page;
  text(page.ops, `TOTAL    Packages ${packages}    Pieces ${pieces}    Gross ${kg(gross)} KG    Net ${kg(net)} KG`, PAGE_W - MARGIN, page.y, 8.5, "right");
}

function paintFooter(cursor: { page: Page }, model: TradePdfModel, images: ImageObj[], fresh: () => void) {
  if (cursor.page.y < 168) fresh();
  const page = cursor.page;
  page.y -= 16;
  const facts = [
    `ORIGIN OF GOODS  ${dash(model.origin)}`,
    `PORT OF LOADING  ${dash(model.portOfLoading)}`,
    `PORT OF DISCHARGE  ${dash(model.portOfDischarge)}`,
    `SHIPPING METHOD  ${dash(model.shippingMethod)}`,
    `PAYMENT TERM  ${dash(model.paymentTerm)}`,
  ];
  for (const fact of facts) {
    text(page.ops, fact, MARGIN, page.y, 8, "left");
    page.y -= 11;
  }
  if (model.kind !== "packing" && model.bank) {
    page.y -= 4;
    text(page.ops, "BANK DETAILS", MARGIN, page.y, 8, "left");
    page.y -= 6;
    const bankLines: Array<[string, string]> = [
      ["ACCOUNT NAME", model.bank.accountName],
      ["ACCOUNT NUMBER (IBAN)", model.bank.iban],
      ["BANK NAME", model.bank.bankName],
      ["BANK ADDRESS", model.bank.bankAddress],
      ["SWIFT CODE", model.bank.swift],
    ];
    for (const [label, value] of bankLines) {
      page.y -= 14;
      boxRow(page.ops, page.y + 12, 14, [150, 210]);
      text(page.ops, label, MARGIN + 4, page.y, 7, "left");
      text(page.ops, value || "—", MARGIN + 154, page.y, 7, "left");
    }
  }
  const stamp = images.find((image) => image.name === "ImStamp");
  const boxX = PAGE_W - MARGIN - 150;
  const boxY = Math.max(BOTTOM + 8, page.y - 78);
  if (stamp) drawImage(page.ops, stamp.name, boxX, boxY, 140, 70);
  else paintVectorStamp(page.ops, model.identity, boxX, boxY);
}

function paintVectorStamp(ops: string[], identity: TradeIdentity, x: number, y: number) {
  ops.push(`${INK} RG`, `1.4 w ${n(x)} ${n(y)} 148 72 re S`);
  text(ops, "APPROVED", x + 74, y + 58, 9, "center");
  text(ops, identity.stampLabelEn || identity.nameEn || "Exporter", x + 74, y + 46, 7, "center");
  if (identity.stampLabelAr || identity.nameAr) text(ops, identity.stampLabelAr || identity.nameAr, x + 74, y + 34, 8, "center");
  text(ops, "Financial Management / الإدارة المالية", x + 74, y + 22, 6.5, "center");
  text(ops, `CR ${dash(identity.commercialRegistry)}  TAX ${dash(identity.taxCard)}`, x + 74, y + 10, 6, "center");
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

function chargesFreight(incoterm: string, shipping: string) {
  const text = `${incoterm} ${shipping}`.toUpperCase();
  return text.includes("CFR") || text.includes("C&F");
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
  const rgb = colors === 4 ? dropAlpha(raw, w, h) : raw;
  return { bytes: rgb, w, h, kind: "png", png: { data: rgb, colors: colors === 4 ? 3 : colors } };
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

function dropAlpha(data: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    out[j] = data[i];
    out[j + 1] = data[i + 1];
    out[j + 2] = data[i + 2];
  }
  return out;
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
  const imageStart = 4;
  const pageStart = imageStart + images.length;
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
  images.forEach((image, index) => {
    objStart(imageStart + index);
    if (image.kind === "jpeg") {
      pushText(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`);
      pushBytes(image.bytes);
      pushText("\nendstream");
    } else {
      const data = image.png?.data ?? image.bytes;
      const space = (image.png?.colors ?? 3) === 1 ? "/DeviceGray" : "/DeviceRGB";
      pushText(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace ${space} /BitsPerComponent 8 /Length ${data.length} >>\nstream\n`);
      pushBytes(data);
      pushText("\nendstream");
    }
    objEnd();
  });
  const xobjects = images.map((image, index) => `/${image.name} ${imageStart + index} 0 R`).join(" ");
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
