/**
 * Local Auto-Draft Persistence for Trade & Operation Editors.
 *
 * Automatically snapshots active editor state (Commercial Invoice, Packing List,
 * Proforma Invoice) to browser storage so zero keystrokes or bascule weights are
 * lost if the network drops or the browser tab is closed before saving.
 */

export type LocalDraftRecord<T = unknown> = {
  scopeKey: string;
  baseVersion: number | string;
  updatedAt: string;
  payload: T;
};

const STORAGE_PREFIX = "ef:auto-draft:v1:";
const memoryFallback = new Map<string, string>();

function readRaw(key: string): string | null {
  const fullKey = `${STORAGE_PREFIX}${key}`;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(fullKey);
    }
  } catch {
    // Fallback to in-memory map if storage is unavailable
  }
  return memoryFallback.get(fullKey) ?? null;
}

function writeRaw(key: string, value: string): void {
  const fullKey = `${STORAGE_PREFIX}${key}`;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(fullKey, value);
      return;
    }
  } catch {
    // Quota exceeded or private mode fallback
  }
  memoryFallback.set(fullKey, value);
}

function removeRaw(key: string): void {
  const fullKey = `${STORAGE_PREFIX}${key}`;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(fullKey);
    }
  } catch {
    // Ignore
  }
  memoryFallback.delete(fullKey);
}

export function saveLocalDraft<T>(
  scopeKey: string,
  baseVersion: number | string,
  payload: T,
): LocalDraftRecord<T> {
  const record: LocalDraftRecord<T> = {
    scopeKey,
    baseVersion,
    updatedAt: new Date().toISOString(),
    payload,
  };
  writeRaw(scopeKey, JSON.stringify(record));
  return record;
}

export function loadLocalDraft<T>(
  scopeKey: string,
  expectedBaseVersion?: number | string,
): LocalDraftRecord<T> | null {
  const raw = readRaw(scopeKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalDraftRecord<T>;
    if (!parsed || typeof parsed !== "object" || !("payload" in parsed)) {
      return null;
    }
    if (
      expectedBaseVersion !== undefined &&
      String(parsed.baseVersion) !== String(expectedBaseVersion)
    ) {
      // Server version has advanced past this local draft; keep only if forced
      return parsed;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalDraft(scopeKey: string): void {
  removeRaw(scopeKey);
}

