import { useRef, useState, type PointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { usePermissions } from "@/lib/permissions";
import { TRADE_PAGE_H, TRADE_PAGE_W, TRADE_STAMP_BASE } from "@shared/trade-sheet";
import { stampPngDataUrl, useStampPreview } from "./TradeExtras";

export type LiveStamp = {
  stamped: boolean;
  xRatio: number;
  yRatio: number;
  scale: number;
  rotation: number;
};

export function blankStamp(): LiveStamp {
  return { stamped: false, xRatio: 0.78, yRatio: 0.16, scale: 1, rotation: -4 };
}

export function stampFromRow(row?: { is_stamped?: number | null; stamp_x_ratio?: number | null; stamp_y_ratio?: number | null; stamp_scale?: number | null; stamp_rotation?: number | null; stamp_x?: number | null; stamp_y?: number | null } | null): LiveStamp {
  if (!row) return blankStamp();
  const xRatio = row.stamp_x_ratio ?? (row.stamp_x != null ? Number(row.stamp_x) / TRADE_PAGE_W : 0.78);
  const yRatio = row.stamp_y_ratio ?? (row.stamp_y != null ? Number(row.stamp_y) / TRADE_PAGE_H : 0.16);
  return {
    stamped: Number(row.is_stamped) === 1,
    xRatio: Number.isFinite(xRatio) ? xRatio : 0.78,
    yRatio: Number.isFinite(yRatio) ? yRatio : 0.16,
    scale: row.stamp_scale == null ? 1 : Number(row.stamp_scale),
    rotation: row.stamp_rotation == null ? -4 : Number(row.stamp_rotation),
  };
}

export type LiveRow = { label: string; value: string };
export type LiveLine = { cells: string[] };

export type LiveSheetModel = {
  title: string;
  draft: boolean;
  identity: { nameEn: string; nameAr: string; address: string; phone: string; email: string; taxCard: string; taxFile: string; commercialRegistry: string };
  meta: LiveRow[];
  buyer: LiveRow[];
  columns: string[];
  lines: LiveLine[];
  totals: LiveRow[];
  facts: LiveRow[];
  bank: LiveRow[];
  clientCode: string;
};

export function LiveInvoiceView({
  model,
  stamp,
  disabled,
  onChange,
}: {
  model: LiveSheetModel;
  stamp: LiveStamp;
  disabled?: boolean;
  onChange: (stamp: LiveStamp) => void;
}) {
  const { tx } = useCopy();
  const perms = usePermissions();
  const client = useQueryClient();
  const preview = useStampPreview();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [arm, setArm] = useState(false);
  const [ghost, setGhost] = useState<{ xRatio: number; yRatio: number } | null>(null);
  const [hit, setHit] = useState(0);
  const [drag, setDrag] = useState(false);

  const canApplyStamp = !disabled && perms.has("trade.stamp.apply");
  const canManageStamp = !disabled && perms.hasAny(["trade.stamp.manage", "settings.manage"]);

  function ratios(event: { clientX: number; clientY: number }) {
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect) return { xRatio: stamp.xRatio, yRatio: stamp.yRatio };
    const xRatio = Math.min(0.96, Math.max(0.04, (event.clientX - rect.left) / rect.width));
    const yRatio = Math.min(0.96, Math.max(0.04, 1 - (event.clientY - rect.top) / rect.height));
    return { xRatio, yRatio };
  }

  async function storeStamp(dataUrl: string) {
    await api("/api/v1/settings/exporter-marks/stamp", { method: "POST", body: JSON.stringify({ dataUrl }) });
    notifySuccess(tx("tradeStampSaved", "Stamp saved"));
    await client.invalidateQueries({ queryKey: ["stamp-preview"] });
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      await storeStamp(await stampPngDataUrl(file));
    } catch (error) {
      notifyError(error);
    }
  }

  async function template(kind: "round" | "rect") {
    try {
      await storeStamp(drawTemplate(kind, model.identity.nameEn || "NANA SECRET"));
    } catch (error) {
      notifyError(error);
    }
  }

  const stampWidth = `${((TRADE_STAMP_BASE * stamp.scale) / TRADE_PAGE_W) * 100}%`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={arm ? "default" : "outline"} disabled={!canApplyStamp} onClick={() => setArm((value) => !value)}>
          {tx("tradeArmStamp", "Stamp with the mouse")}
        </Button>
        {canManageStamp ? (
          <>
            <label className="inline-flex cursor-pointer items-center">
              <input className="sr-only" type="file" accept="image/png,image/jpeg" disabled={!canManageStamp} onChange={(event) => void upload(event.target.files?.[0])} />
              <span className="rounded-control border border-line px-2 py-1 text-xs text-ink">{tx("tradeReplaceStamp", "Change stamp image")}</span>
            </label>
            <Button type="button" size="sm" variant="outline" disabled={!canManageStamp} onClick={() => void template("round")}>{tx("tradeRoundStamp", "Round stamp")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={!canManageStamp} onClick={() => void template("rect")}>{tx("tradeRectStamp", "Rectangular stamp")}</Button>
          </>
        ) : null}
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          {tx("tradeStampScale", "Size")}
          <input type="range" min="0.4" max="2" step="0.05" disabled={!canApplyStamp} value={stamp.scale} onChange={(event) => onChange({ ...stamp, scale: Number(event.target.value) })} />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          {tx("tradeStampAngle", "Angle")}
          <input type="range" min="-30" max="30" step="1" disabled={!canApplyStamp} value={stamp.rotation} onChange={(event) => onChange({ ...stamp, rotation: Number(event.target.value) })} />
        </label>
        <Button type="button" size="sm" variant="outline" disabled={!canApplyStamp || !stamp.stamped} onClick={() => onChange({ ...stamp, stamped: false })}>{tx("tradeClearStamp", "Clear stamp")}</Button>
      </div>
      <div className="overflow-auto rounded-card border border-line bg-paper p-3">
          <div className="flex flex-col gap-4">
            {paginate(model).map((page, pageIndex) => (
              <div
                key={pageIndex}
                ref={pageIndex === 0 ? sheetRef : undefined}
                className="relative mx-auto overflow-hidden bg-white text-[#0f172a] shadow-card"
                style={{ width: "min(100%, 720px)", aspectRatio: `${TRADE_PAGE_W} / ${TRADE_PAGE_H}`, cursor: arm && pageIndex === 0 ? "none" : "default" }}
                dir="ltr"
                onMouseMove={pageIndex === 0 ? (event) => {
                  if (drag) onChange({ ...stamp, ...ratios(event), stamped: true });
                  else if (arm) setGhost(ratios(event));
                } : undefined}
                onMouseLeave={pageIndex === 0 ? () => { setGhost(null); setDrag(false); } : undefined}
                onClick={pageIndex === 0 ? (event) => {
                  if (!arm || !canApplyStamp || drag) return;
                  const target = event.target as HTMLElement;
                  if (target.dataset.stamp === "placed") return;
                  onChange({ ...stamp, ...ratios(event), stamped: true });
                  setHit((value) => value + 1);
                } : undefined}
              >
                <div className="absolute inset-[5%] flex flex-col gap-2 overflow-hidden text-left text-[11px] leading-tight text-[#0f172a]" dir="ltr">
                  {pageIndex === 0 ? (
                    <>
                      <header className="text-center">
                        <strong className="block text-[15px] tracking-wide">{model.identity.nameEn || "Exporter"}</strong>
                        <p className="mt-1 text-[10px]">FACTORY ADDRESS : {model.identity.address}</p>
                        <p className="text-[10px]">MOBILE: {model.identity.phone || "—"} &nbsp;&nbsp; E-MAIL: {model.identity.email || "—"}</p>
                        <p className="text-[9px]">TAX CARD : {model.identity.taxCard || "—"} &nbsp; TAX FILE : {model.identity.taxFile || "—"} &nbsp; COMMERCIAL REGISTRY : {model.identity.commercialRegistry || "—"}</p>
                        <div className="mx-auto mt-1 h-px w-full bg-[#0f172a]" />
                        <p className="mt-2 text-sm font-bold underline">{model.title}{model.draft ? " - DRAFT" : ""}</p>
                      </header>
                      <div className="flex items-start justify-between gap-3">
                        <table className="w-[64%] border-collapse text-center text-[10px]">
                          <tbody>
                            {model.buyer.map((row, index) => (
                              <tr key={`${row.label}-${index}`}>
                                <th className="w-[36%] border border-[#0f172a] px-1 py-1 font-semibold">{row.label}</th>
                                <td className="border border-[#0f172a] px-1 py-1">{row.value || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="flex w-[34%] flex-col items-center">
                        <table className="w-full border-collapse text-center text-[10px]">
                          <tbody>
                            {model.meta.map((row, index) => (
                              <tr key={`${row.label}-${index}`}>
                                <th className="border border-[#0f172a] px-1 py-1 font-semibold">{row.label}</th>
                                <td className="border border-[#0f172a] px-1 py-1">{row.value || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!stamp.stamped && preview.data ? <img src={preview.data} alt="" className="mt-2 w-[78%] object-contain" style={{ transform: `rotate(${stamp.rotation}deg)` }} /> : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                  <table className="w-full border-collapse text-center text-[10px]">
                    <thead className="bg-[#e5e7eb]">
                      <tr>{model.columns.map((column) => <th key={column} className="border border-[#0f172a] px-1 py-1 align-middle font-semibold">{column}</th>)}</tr>
                    </thead>
                    <tbody>
                      {page.lines.map((line, index) => (
                        <tr key={index}>
                          {line.cells.map((cell, cellIndex) => (
                            <td key={cellIndex} className="border border-[#0f172a] px-1 py-1 align-middle whitespace-pre-line">{cell}</td>
                          ))}
                        </tr>
                      ))}
                      {page.showTail ? model.totals.map((row) => (
                        <tr key={row.label} className="bg-[#e5e7eb] font-semibold">
                          <td className="border border-[#0f172a] px-1 py-1 text-right" colSpan={Math.max(1, model.columns.length - 1)}>{row.label}</td>
                          <td className="border border-[#0f172a] px-1 py-1 text-right">{row.value}</td>
                        </tr>
                      )) : null}
                    </tbody>
                  </table>
                  {page.showTail ? (
                    <div className="space-y-0.5 text-[10px] leading-4">
                      {model.facts.map((row) => <p key={row.label}>{row.label}{row.label.includes("ORIGIN") ? " " : " : "}{row.value || "—"}</p>)}
                      {model.bank.map((row) => <p key={row.label}>{row.label} : {row.value || "—"}</p>)}
                    </div>
                  ) : null}
                  <p className="mt-auto text-center text-[11px]">{model.clientCode}</p>
                </div>
                {pageIndex === 0 && arm && ghost && preview.data ? <StampImage src={preview.data} xRatio={ghost.xRatio} yRatio={ghost.yRatio} width={stampWidth} rotation={stamp.rotation} faint /> : null}
                {pageIndex === 0 && stamp.stamped && preview.data ? (
                  <StampImage
                    src={preview.data}
                    xRatio={stamp.xRatio}
                    yRatio={stamp.yRatio}
                    width={stampWidth}
                    rotation={stamp.rotation}
                    hit={hit}
                    onPointerDown={(event) => {
                      if (!canApplyStamp) return;
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDrag(true);
                    }}
                    onPointerUp={() => setDrag(false)}
                  />
                ) : null}
              </div>
            ))}
          </div>
      </div>
      {!preview.data ? <p className="text-xs text-ink-muted">{tx("tradeStampMissing", "Upload a transparent PNG stamp before placing it.")}</p> : null}
      <style>{`@keyframes exportflow-stamp-hit { 0% { transform: translate(-50%, calc(50% - 28px)) scale(1.35) rotate(var(--tilt, 0deg)); opacity: 0.2; } 60% { transform: translate(-50%, 54%) scale(0.92); opacity: 1; } 100% { transform: translate(-50%, 50%) scale(1); } }`}</style>
    </div>
  );
}

function paginate(model: LiveSheetModel) {
  const limit = 18;
  if (model.lines.length <= limit) return [{ lines: model.lines, showTail: true }];
  const pages: Array<{ lines: LiveLine[]; showTail: boolean }> = [];
  pages.push({ lines: model.lines.slice(0, limit), showTail: false });
  for (let index = limit; index < model.lines.length; index += limit) {
    const slice = model.lines.slice(index, index + limit);
    pages.push({ lines: slice, showTail: index + limit >= model.lines.length });
  }
  return pages;
}

function StampImage({
  src,
  xRatio,
  yRatio,
  width,
  rotation,
  faint,
  hit,
  onPointerDown,
  onPointerUp,
}: {
  src: string;
  xRatio: number;
  yRatio: number;
  width: string;
  rotation: number;
  faint?: boolean;
  hit?: number;
  onPointerDown?: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerUp?: () => void;
}) {
  return (
    <img
      key={hit}
      data-stamp={faint ? "ghost" : "placed"}
      alt=""
      src={src}
      className="absolute origin-center"
      style={{
        left: `${xRatio * 100}%`,
        bottom: `${yRatio * 100}%`,
        width,
        transform: `translate(-50%, 50%) rotate(${rotation}deg)`,
        opacity: faint ? 0.45 : 1,
        pointerEvents: faint ? "none" : "auto",
        animation: faint ? undefined : "exportflow-stamp-hit 520ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function drawTemplate(kind: "round" | "rect", name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = kind === "round" ? 520 : 560;
  canvas.height = kind === "round" ? 520 : 300;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#7f1d1d";
  context.fillStyle = "#7f1d1d";
  context.lineWidth = 12;
  context.textAlign = "center";
  if (kind === "round") {
    context.beginPath();
    context.arc(260, 260, 220, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(260, 260, 186, 0, Math.PI * 2);
    context.stroke();
    context.font = "bold 58px sans-serif";
    context.fillText("APPROVED", 260, 250);
    context.font = "28px sans-serif";
    context.fillText(name.slice(0, 22), 260, 300);
  } else {
    context.strokeRect(18, 18, 524, 264);
    context.strokeRect(34, 34, 492, 232);
    context.font = "bold 52px sans-serif";
    context.fillText("APPROVED", 280, 150);
    context.font = "26px sans-serif";
    context.fillText(name.slice(0, 28), 280, 198);
  }
  return canvas.toDataURL("image/png");
}
