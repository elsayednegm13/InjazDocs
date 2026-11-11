import { useSyncExternalStore } from "react";

export type OutboxItemStatus = "queued" | "syncing" | "conflict";

export type OutboxItem = {
  id: string;
  method: string;
  path: string;
  body: string;
  idempotencyKey: string;
  coalesceKey: string | null;
  label: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  status: OutboxItemStatus;
  lastError?: string;
  conflictStatus?: number;
};

export type OfflineSyncSnapshot = {
  isOnline: boolean;
  isSyncing: boolean;
  queuedCount: number;
  conflictCount: number;
  items: OutboxItem[];
  lastSyncedAt: number | null;
};

type ReplayExecutor = (item: OutboxItem) => Promise<{ ok: boolean; status: number; errorMessage?: string }>;
type SyncCompleteListener = (syncedCount: number) => void;

const STORAGE_PREFIX = "ef:offline:outbox:v1:";
const memoryStore = new Map<string, string>();

let currentScope = "anonymous";
let isOnlineState = typeof navigator !== "undefined" ? navigator.onLine !== false : true;
let isSyncingState = false;
let lastSyncedAtState: number | null = null;
let itemsState: OutboxItem[] = [];
let cachedSnapshot: OfflineSyncSnapshot | null = null;

const subscribers = new Set<() => void>();
const syncCompleteListeners = new Set<SyncCompleteListener>();
let customReplayExecutor: ReplayExecutor | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;

function storageKey(scope = currentScope) {
  return `${STORAGE_PREFIX}${scope}`;
}

function readRaw(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Fallback to memory store
  }
  return memoryStore.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  memoryStore.set(key, value);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore quota errors
  }
}

function loadItemsForScope(scope: string): OutboxItem[] {
  const raw = readRaw(storageKey(scope));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: OutboxItem) => ({
      ...item,
      status: item.status === "syncing" ? "queued" : item.status,
    }));
  } catch {
    return [];
  }
}

function persistItems() {
  writeRaw(storageKey(currentScope), JSON.stringify(itemsState));
}

function emitChange() {
  cachedSnapshot = null;
  for (const listener of subscribers) {
    listener();
  }
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const QUEUEABLE_PATTERNS: Array<{
  method: string;
  regex: RegExp;
  coalesce: boolean;
  labelAr: string;
}> = [
  {
    method: "PUT",
    regex: /^\/api\/v1\/invoices\/[^/]+\/trade-header$/,
    coalesce: true,
    labelAr: "تحديث ترويسة وشروط الفاتورة التجارية",
  },
  {
    method: "PUT",
    regex: /^\/api\/v1\/invoices\/[^/]+\/lines$/,
    coalesce: true,
    labelAr: "حفظ بنود الفاتورة التجارية",
  },
  {
    method: "PUT",
    regex: /^\/api\/v1\/invoices\/[^/]+\/packing-lines$/,
    coalesce: true,
    labelAr: "حفظ بنود وأوزان بيان العبوة",
  },
  {
    method: "POST",
    regex: /^\/api\/v1\/invoices\/[^/]+\/sync-totals$/,
    coalesce: true,
    labelAr: "مزامنة إجماليات الطرود والأوزان",
  },
  {
    method: "PUT",
    regex: /^\/api\/v1\/proformas\/[^/]+$/,
    coalesce: true,
    labelAr: "حفظ مسودة الفاتورة المبدئية",
  },
  {
    method: "POST",
    regex: /^\/api\/v1\/proformas$/,
    coalesce: false,
    labelAr: "إنشاء مسودة فاتورة مبدئية جديدة",
  },
  {
    method: "PATCH",
    regex: /^\/api\/v1\/export-cases\/[^/]+$/,
    coalesce: true,
    labelAr: "تحديث بيانات العملية التصديرية",
  },
  {
    method: "PATCH",
    regex: /^\/api\/v1\/containers\/[^/]+$/,
    coalesce: true,
    labelAr: "تحديث بيانات الحاوية",
  },
  {
    method: "POST",
    regex: /^\/api\/v1\/containers\/[^/]+\/number$/,
    coalesce: true,
    labelAr: "حفظ الرقم الرسمي للحاوية",
  },
  {
    method: "PATCH",
    regex: /^\/api\/v1\/customers\/[^/]+$/,
    coalesce: true,
    labelAr: "تحديث بيانات العميل",
  },
  {
    method: "PUT",
    regex: /^\/api\/v1\/customers\/[^/]+\/print-profile$/,
    coalesce: true,
    labelAr: "تحديث ملف الطباعة للعميل",
  },
  {
    method: "PATCH",
    regex: /^\/api\/v1\/quotations\/[^/]+$/,
    coalesce: true,
    labelAr: "حفظ تعديلات عرض السعر",
  },
];

export function isQueueableOfflineMutation(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  const cleanPath = path.split("?")[0] ?? path;
  return QUEUEABLE_PATTERNS.some((entry) => entry.method === upper && entry.regex.test(cleanPath));
}

export function describeOfflineMutation(method: string, path: string): {
  coalesceKey: string | null;
  label: string;
} {
  const upper = method.toUpperCase();
  const cleanPath = path.split("?")[0] ?? path;
  const match = QUEUEABLE_PATTERNS.find((entry) => entry.method === upper && entry.regex.test(cleanPath));
  if (!match) {
    return {
      coalesceKey: upper === "PUT" || upper === "PATCH" ? `${upper} ${cleanPath}` : null,
      label: `${upper} ${cleanPath}`,
    };
  }
  return {
    coalesceKey: match.coalesce ? `${upper} ${cleanPath}` : null,
    label: match.labelAr,
  };
}

export function buildOfflineOptimisticData(method: string, path: string, bodyText: string): unknown {
  const upper = method.toUpperCase();
  const cleanPath = path.split("?")[0] ?? path;
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    parsedBody = {};
  }

  if (upper === "PUT" && /^\/api\/v1\/invoices\/[^/]+\/packing-lines$/.test(cleanPath)) {
    const lines = Array.isArray(parsedBody.lines) ? (parsedBody.lines as Array<Record<string, unknown>>) : [];
    const packages = lines.reduce((sum, l) => sum + (Number(l.packagesCount) || 0), 0);
    const grossGrams = lines.reduce((sum, l) => sum + (Number(l.grossWeightGrams) || 0), 0);
    const netGrams = lines.reduce((sum, l) => sum + (Number(l.netWeightGrams) || 0), 0);
    const pieces = lines.reduce(
      (sum, l) => sum + (Number(l.packagesCount) || 0) * (Number(l.packingPerPackage) || 0),
      0,
    );
    return {
      reconciliation: {
        matched: true,
        invoice: { packages, grossGrams, netGrams, pieces },
        packing: { packages, grossGrams, netGrams, pieces },
      },
    };
  }

  if (upper === "POST" && /^\/api\/v1\/invoices\/[^/]+\/sync-totals$/.test(cleanPath)) {
    return {
      matched: true,
      invoice: { packages: 0, grossGrams: 0, netGrams: 0, pieces: 0 },
      packing: { packages: 0, grossGrams: 0, netGrams: 0, pieces: 0 },
    };
  }

  if (upper === "POST" && cleanPath === "/api/v1/proformas") {
    return {
      id: `offline-pi-${Date.now()}`,
      invoice_number: String(parsedBody.invoiceNumber ?? "PI-DRAFT"),
      status: "DRAFT",
    };
  }

  return { ok: true, queuedOffline: true };
}

export function setOfflineOutboxScope(scope: string) {
  const nextScope = scope || "anonymous";
  if (currentScope === nextScope && itemsState.length > 0) return;
  currentScope = nextScope;
  itemsState = loadItemsForScope(currentScope);
  emitChange();
}

export function setOfflineStatus(online: boolean) {
  if (isOnlineState === online) return;
  isOnlineState = online;
  emitChange();
}

export function enqueueOfflineMutation(input: {
  method: string;
  path: string;
  body: string;
  idempotencyKey?: string;
  label?: string;
}): OutboxItem {
  const method = input.method.toUpperCase();
  const path = input.path;
  const meta = describeOfflineMutation(method, path);
  const coalesceKey = meta.coalesceKey;
  const now = Date.now();

  if (coalesceKey) {
    const existingIndex = itemsState.findIndex(
      (item) => item.status === "queued" && item.coalesceKey === coalesceKey,
    );
    if (existingIndex !== -1) {
      const existing = itemsState[existingIndex]!;
      const updated: OutboxItem = {
        ...existing,
        body: input.body,
        idempotencyKey: input.idempotencyKey || existing.idempotencyKey || newId(),
        label: input.label || meta.label,
        updatedAt: now,
      };
      itemsState = [
        ...itemsState.slice(0, existingIndex),
        updated,
        ...itemsState.slice(existingIndex + 1),
      ];
      persistItems();
      isOnlineState = false;
      emitChange();
      ensureHeartbeat();
      return updated;
    }
  }

  const created: OutboxItem = {
    id: newId(),
    method,
    path,
    body: input.body,
    idempotencyKey: input.idempotencyKey || newId(),
    coalesceKey,
    label: input.label || meta.label,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    status: "queued",
  };

  itemsState = [...itemsState, created];
  persistItems();
  isOnlineState = false;
  emitChange();
  ensureHeartbeat();
  return created;
}

export function dismissOutboxItem(id: string) {
  const next = itemsState.filter((item) => item.id !== id);
  if (next.length === itemsState.length) return;
  itemsState = next;
  persistItems();
  emitChange();
}

export function retryOutboxConflict(id: string) {
  let changed = false;
  itemsState = itemsState.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return {
      ...item,
      status: "queued" as const,
      lastError: undefined,
      conflictStatus: undefined,
      updatedAt: Date.now(),
    };
  });
  if (changed) {
    persistItems();
    emitChange();
    void flushOfflineOutbox();
  }
}

export function clearOfflineOutbox() {
  itemsState = [];
  persistItems();
  emitChange();
}

export function setCustomReplayExecutor(executor: ReplayExecutor | null) {
  customReplayExecutor = executor;
}

export function onOfflineSyncComplete(listener: SyncCompleteListener): () => void {
  syncCompleteListeners.add(listener);
  return () => {
    syncCompleteListeners.delete(listener);
  };
}

async function defaultReplayExecutor(item: OutboxItem): Promise<{
  ok: boolean;
  status: number;
  errorMessage?: string;
}> {
  try {
    const res = await fetch(item.path, {
      method: item.method,
      headers: {
        "content-type": "application/json",
        "idempotency-key": item.idempotencyKey,
        "x-offline-replay": "1",
      },
      body: item.body,
      credentials: "include",
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    let errorMessage = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json?.error?.message) errorMessage = json.error.message;
    } catch {
      // ignore parse errors
    }
    return { ok: false, status: res.status, errorMessage };
  } catch {
    return { ok: false, status: 0, errorMessage: "NETWORK_UNAVAILABLE" };
  }
}

export async function probeServerReachability(): Promise<boolean> {
  if (customReplayExecutor) {
    isOnlineState = true;
    emitChange();
    return true;
  }
  try {
    const res = await fetch("/api/v1/health/live", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    const reachable = res.ok || res.status === 401;
    setOfflineStatus(reachable);
    return reachable;
  } catch {
    setOfflineStatus(false);
    return false;
  }
}

export async function flushOfflineOutbox(): Promise<{
  syncedCount: number;
  conflictCount: number;
  remainingQueued: number;
}> {
  if (isSyncingState) {
    return {
      syncedCount: 0,
      conflictCount: itemsState.filter((i) => i.status === "conflict").length,
      remainingQueued: itemsState.filter((i) => i.status === "queued").length,
    };
  }

  const hasQueued = itemsState.some((item) => item.status === "queued");
  if (!hasQueued) {
    const reachable = await probeServerReachability();
    if (reachable) stopHeartbeatIfIdle();
    return {
      syncedCount: 0,
      conflictCount: itemsState.filter((i) => i.status === "conflict").length,
      remainingQueued: 0,
    };
  }

  const reachable = await probeServerReachability();
  if (!reachable) {
    return {
      syncedCount: 0,
      conflictCount: itemsState.filter((i) => i.status === "conflict").length,
      remainingQueued: itemsState.filter((i) => i.status === "queued").length,
    };
  }

  isSyncingState = true;
  emitChange();

  let syncedCount = 0;
  const executor = customReplayExecutor ?? defaultReplayExecutor;

  try {
    // Sort FIFO by createdAt ascending
    const queueOrder = [...itemsState]
      .filter((item) => item.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const target of queueOrder) {
      const current = itemsState.find((i) => i.id === target.id);
      if (!current || current.status !== "queued") continue;

      itemsState = itemsState.map((item) =>
        item.id === current.id ? { ...item, status: "syncing" as const } : item,
      );
      emitChange();

      const result = await executor(current);

      if (result.ok) {
        itemsState = itemsState.filter((item) => item.id !== current.id);
        syncedCount += 1;
        persistItems();
        emitChange();
        continue;
      }

      if (result.status === 0 || result.status >= 500 || result.status === 408 || result.status === 429) {
        // Transient or network failure: return item to queued state and pause flushing
        itemsState = itemsState.map((item) =>
          item.id === current.id
            ? {
                ...item,
                status: "queued" as const,
                attempts: item.attempts + 1,
                lastError: result.errorMessage,
                updatedAt: Date.now(),
              }
            : item,
        );
        persistItems();
        if (result.status === 0) {
          isOnlineState = false;
        }
        emitChange();
        break;
      }

      // 409 Conflict / 422 Validation / permanent 4xx: isolate item as conflict without blocking rest of queue
      itemsState = itemsState.map((item) =>
        item.id === current.id
          ? {
              ...item,
              status: "conflict" as const,
              attempts: item.attempts + 1,
              conflictStatus: result.status,
              lastError: result.errorMessage || `تعذر تطبيق التعديل (${result.status})`,
              updatedAt: Date.now(),
            }
          : item,
      );
      persistItems();
      emitChange();
    }
  } finally {
    isSyncingState = false;
    if (syncedCount > 0) {
      lastSyncedAtState = Date.now();
    }
    emitChange();
  }

  if (syncedCount > 0) {
    for (const listener of syncCompleteListeners) {
      try {
        listener(syncedCount);
      } catch {
        // ignore listener errors
      }
    }
  }

  stopHeartbeatIfIdle();

  return {
    syncedCount,
    conflictCount: itemsState.filter((i) => i.status === "conflict").length,
    remainingQueued: itemsState.filter((i) => i.status === "queued").length,
  };
}

function stopHeartbeatIfIdle() {
  const hasQueued = itemsState.some((item) => item.status === "queued");
  if (isOnlineState && !hasQueued && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function ensureHeartbeat() {
  if (typeof window === "undefined") return;
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const hasQueued = itemsState.some((item) => item.status === "queued");
    if (!isOnlineState || hasQueued) {
      void flushOfflineOutbox();
    } else {
      stopHeartbeatIfIdle();
    }
  }, 15_000);
}

export function initOfflineOutboxListeners() {
  if (typeof window === "undefined" || listenersBound) return;
  listenersBound = true;
  itemsState = loadItemsForScope(currentScope);

  window.addEventListener("online", () => {
    setOfflineStatus(true);
    void flushOfflineOutbox();
  });

  window.addEventListener("offline", () => {
    setOfflineStatus(false);
    ensureHeartbeat();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const hasQueued = itemsState.some((item) => item.status === "queued");
      if (!isOnlineState || hasQueued) {
        void flushOfflineOutbox();
      }
    }
  });

  if (!isOnlineState || itemsState.some((item) => item.status === "queued")) {
    ensureHeartbeat();
  }
}

export function getOfflineSyncSnapshot(): OfflineSyncSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  const queuedCount = itemsState.filter((i) => i.status === "queued" || i.status === "syncing").length;
  const conflictCount = itemsState.filter((i) => i.status === "conflict").length;
  cachedSnapshot = {
    isOnline: isOnlineState,
    isSyncing: isSyncingState,
    queuedCount,
    conflictCount,
    items: itemsState,
    lastSyncedAt: lastSyncedAtState,
  };
  return cachedSnapshot;
}

function subscribeOfflineSync(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function useOfflineSyncStatus(): OfflineSyncSnapshot {
  return useSyncExternalStore(subscribeOfflineSync, getOfflineSyncSnapshot, getOfflineSyncSnapshot);
}

