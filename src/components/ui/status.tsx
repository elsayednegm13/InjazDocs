import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  DRAFT: "bg-paper text-ink",
  ACTIVE: "bg-accent/15 text-accent",
  PENDING: "bg-warn/15 text-warn",
  SNOOZED: "bg-warn/15 text-warn",
  ON_HOLD: "bg-warn/15 text-warn",
  COMPLETED: "bg-ok/15 text-ok",
  APPROVED: "bg-ok/15 text-ok",
  WAIVED: "bg-ok/15 text-ok",
  RESOLVED: "bg-ok/15 text-ok",
  DELIVERED: "bg-ok/15 text-ok",
  DELIVERED_TO_CUSTOMER: "bg-ok/15 text-ok",
  BANK_APPROVED: "bg-ok/15 text-ok",
  CANCELLED: "bg-danger/15 text-danger",
  MISSING: "bg-danger/15 text-danger",
  NEEDS_CORRECTION: "bg-danger/15 text-danger",
  CORRECTION_REQUESTED: "bg-danger/15 text-danger",
  IN_TRANSIT: "bg-accent/15 text-accent",
  UPLOADED: "bg-accent/15 text-accent",
  UNDER_REVIEW: "bg-warn/15 text-warn",
};

export function StatusBadge({ value }: { value?: string | null }) {
  const { tx } = useCopy();
  if (!value) return <span className="text-ink-muted">—</span>;
  const english = value.replaceAll("_", " ");
  return (
    <span
      data-status={value}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        tones[value] ?? "bg-paper text-ink",
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {tx(`status.${value}`, english)}
    </span>
  );
}
