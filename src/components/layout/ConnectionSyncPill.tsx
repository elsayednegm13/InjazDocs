import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/copy";
import {
  dismissOutboxItem,
  flushOfflineOutbox,
  retryOutboxConflict,
  useOfflineSyncStatus,
} from "@/lib/offline-outbox";
import { cn } from "@/lib/utils";

export function ConnectionSyncPill() {
  const { tx, i18n } = useCopy();
  const ar = i18n.language.startsWith("ar");
  const status = useOfflineSyncStatus();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const { isOnline, isSyncing, queuedCount, conflictCount, items } = status;

  let pillLabel = ar ? "متصل ومحفوظ" : tx("syncOnlineSaved", "Online & saved");
  let pillTone = "border-ok/30 bg-ok/10 text-ok hover:bg-ok/15";
  let Icon = CheckCircle2;

  if (isSyncing) {
    pillLabel = ar ? "جاري مزامنة التعديلات..." : tx("syncInProgress", "Syncing changes...");
    pillTone = "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15";
    Icon = RefreshCw;
  } else if (conflictCount > 0) {
    pillLabel = ar
      ? `تعارض مزامنة (${conflictCount}) يحتاج مراجعة`
      : `${conflictCount} sync conflict(s)`;
    pillTone = "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15";
    Icon = AlertTriangle;
  } else if (!isOnline || queuedCount > 0) {
    pillLabel =
      queuedCount > 0
        ? ar
          ? `وضع عدم الاتصال — ${queuedCount} تعديلات محفوظة محلياً`
          : `Offline — ${queuedCount} local change(s) queued`
        : ar
          ? "وضع عدم الاتصال — الحفظ المحلي مفعل"
          : "Offline — local auto-save active";
    pillTone = "border-warn/40 bg-warn/15 text-warn hover:bg-warn/20";
    Icon = CloudOff;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        data-testid="connection-sync-pill"
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
          pillTone,
        )}
        title={pillLabel}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", isSyncing && "animate-spin")} />
        <span className="max-w-[220px] truncate">{pillLabel}</span>
      </button>

      {open ? (
        <div
          className="absolute end-0 top-11 z-50 w-80 rounded-2xl border border-line bg-card p-3.5 text-start shadow-xl sm:w-96"
          role="dialog"
          aria-label={ar ? "حالة الاتصال وطابور المزامنة" : "Connection and sync queue"}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line pb-2.5">
            <div>
              <p className="text-xs font-bold text-ink">
                {ar ? "محرك استمرارية العمل والمزامنة" : "Offline Resilience & Sync Queue"}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted">
                {isOnline
                  ? ar
                    ? "الاتصال بالخادم نشط ومستقر"
                    : "Server connection is active"
                  : ar
                    ? "الاتصال مقطوع مؤقتاً — تُحفظ التعديلات محلياً"
                    : "Disconnected — changes are stored locally"}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSyncing}
              onClick={() => void flushOfflineOutbox()}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
              <span>{ar ? "مزامنة الآن" : "Sync now"}</span>
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="py-5 text-center text-xs text-ink-muted">
              <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5 text-ok" />
              <p className="font-medium text-ink">
                {ar ? "جميع التعديلات محفوظة ومتزامنة مع الخادم" : "All changes are synced with the server"}
              </p>
              <p className="mt-0.5 text-[11px]">
                {ar
                  ? "لا توجد أي عمليات معلقة في طابور المزامنة المحلي."
                  : "No pending operations in the local outbox queue."}
              </p>
            </div>
          ) : (
            <div className="mt-2.5 max-h-64 space-y-2 overflow-y-auto pe-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-xl border p-2.5 text-xs",
                    item.status === "conflict"
                      ? "border-danger/40 bg-danger/5"
                      : "border-line bg-paper/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{item.label}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-ink-muted" dir="ltr">
                        {item.method} {item.path}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        item.status === "conflict"
                          ? "bg-danger/15 text-danger"
                          : item.status === "syncing"
                            ? "bg-accent/15 text-accent"
                            : "bg-warn/15 text-warn",
                      )}
                    >
                      {item.status === "conflict"
                        ? ar
                          ? "تعارض"
                          : "Conflict"
                        : item.status === "syncing"
                          ? ar
                            ? "جاري الإرسال"
                            : "Syncing"
                          : ar
                            ? "في الطابور"
                            : "Queued"}
                    </span>
                  </div>
                  {item.lastError ? (
                    <p className="mt-1.5 text-[11px] text-danger">{item.lastError}</p>
                  ) : null}
                  {item.status === "conflict" ? (
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => retryOutboxConflict(item.id)}
                      >
                        {ar ? "إعادة المحاولة" : "Retry"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] text-danger"
                        onClick={() => dismissOutboxItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>{ar ? "استبعاد" : "Dismiss"}</span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

