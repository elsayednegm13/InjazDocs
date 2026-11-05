import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useCopy } from "@/lib/copy";

/**
 * Small "live" pill: shows whether the workspace is connected and whether any
 * background sync/mutation is running, so operators never wonder if data is stale.
 */
export function LiveIndicator() {
  const { tx } = useCopy();
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const busy = fetching > 0 || mutating > 0;
  const tone = !online ? "bg-danger" : busy ? "bg-warn" : "bg-ok";
  const label = !online ? tx("offline", "Offline") : busy ? tx("syncing", "Syncing…") : tx("live", "Live");

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[11px] font-semibold text-ink-muted sm:inline-flex"
      title={tx("liveHint", "Updates arrive automatically. No manual refresh needed.")}
    >
      <span className={`h-2 w-2 rounded-full ${tone} ${busy && online ? "animate-pulse" : ""}`} aria-hidden />
      {label}
    </span>
  );
}
