export const TRADE_PAGE_W = 595.28;
export const TRADE_PAGE_H = 841.89;
export const TRADE_STAMP_BASE = 118;

export function tradeRowHeight(lines: number, size: number) {
  return 12 + Math.max(1, lines) * (size + 2);
}

export function stampCenterFromRatio(xRatio: number, yRatio: number) {
  return { x: xRatio * TRADE_PAGE_W, y: yRatio * TRADE_PAGE_H };
}
