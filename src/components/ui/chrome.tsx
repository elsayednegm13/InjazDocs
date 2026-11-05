import type { ReactNode } from "react";
import { FileCheck2, Ship } from "lucide-react";
import { Link } from "react-router";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
  kicker,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  kicker?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {kicker ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">{kicker}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  children,
  className,
  icon,
  action,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    // min-w-0 lets the card shrink inside a grid or flex parent, so a long
    // value cannot push the whole page into a horizontal scroll.
    <section className={cn("min-w-0 rounded-card border border-line bg-card p-4 shadow-card", className)}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
            {icon ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent/10 text-accent">{icon}</span> : null}
            <span className="truncate">{title}</span>
          </h2>
          {action ? <div className="shrink-0 text-xs font-semibold">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const STAT_TONES = {
  blue: { card: "border-[var(--ef-stat-blue-border)] bg-[var(--ef-stat-blue-bg)]", chip: "bg-[var(--ef-stat-blue-chip)] text-[var(--ef-stat-blue-ink)]" },
  teal: { card: "border-[var(--ef-stat-teal-border)] bg-[var(--ef-stat-teal-bg)]", chip: "bg-[var(--ef-stat-teal-chip)] text-accent" },
  amber: { card: "border-[var(--ef-stat-amber-border)] bg-[var(--ef-stat-amber-bg)]", chip: "bg-[var(--ef-stat-amber-chip)] text-[var(--ef-stat-amber-ink)]" },
  green: { card: "border-[var(--ef-stat-green-border)] bg-[var(--ef-stat-green-bg)]", chip: "bg-[var(--ef-stat-green-chip)] text-ok" },
  rose: { card: "border-[var(--ef-stat-rose-border)] bg-[var(--ef-stat-rose-bg)]", chip: "bg-[var(--ef-stat-rose-chip)] text-danger" },
  plain: { card: "border-line bg-card", chip: "bg-paper text-accent" },
} as const;

export type StatTone = keyof typeof STAT_TONES;

export function StatCard({
  label,
  value,
  href,
  hint,
  icon,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
}) {
  const palette = STAT_TONES[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-ink-muted">{label}</div>
          <div className="mt-2.5 text-[30px] font-semibold leading-none tabular-nums tracking-tight text-ink">
            <Ltr>{value}</Ltr>
          </div>
        </div>
        {icon ? <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-control", palette.chip)}>{icon}</span> : null}
      </div>
      {hint ? <p className="mt-2.5 line-clamp-2 text-[11px] leading-snug text-ink-muted">{hint}</p> : null}
    </>
  );
  const className = cn("block min-w-0 rounded-card border px-4 py-4 shadow-card transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:shadow-tower", palette.card);
  if (!href) return <div className={className}>{body}</div>;
  return (
    <Link className={className} to={href}>
      {body}
    </Link>
  );
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("unicode-isolate", className)}>
      {children}
    </bdi>
  );
}

export function EmptyState({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <p className={cn(
      "border border-dashed border-line bg-paper/60 text-ink-muted",
      compact ? "rounded-control px-3 py-3 text-xs" : "rounded-card px-4 py-6 text-sm",
    )}>
      {children}
    </p>
  );
}

export function AlertText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-control bg-paper px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

type LaneStep = { key: string; label: string };

export function DualLane({
  documentTitle,
  documentStatus,
  documentHint,
  documentSteps,
  documentCurrent,
  goodsTitle,
  goodsStatus,
  goodsHint,
  goodsSteps,
  goodsCurrent,
}: {
  documentTitle: string;
  documentStatus?: string | null;
  documentHint: ReactNode;
  documentSteps: LaneStep[];
  documentCurrent: string;
  goodsTitle: string;
  goodsStatus?: string | null;
  goodsHint: ReactNode;
  goodsSteps: LaneStep[];
  goodsCurrent: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Lane
        title={documentTitle}
        status={documentStatus}
        hint={documentHint}
        steps={documentSteps}
        current={documentCurrent}
        tone="docs"
      />
      <Lane title={goodsTitle} status={goodsStatus} hint={goodsHint} steps={goodsSteps} current={goodsCurrent} tone="cargo" />
    </div>
  );
}

function Lane({
  title,
  status,
  hint,
  steps,
  current,
  tone,
}: {
  title: string;
  status?: string | null;
  hint: ReactNode;
  steps: LaneStep[];
  current: string;
  tone: "docs" | "cargo";
}) {
  const { tx } = useCopy();
  const foundIndex = steps.findIndex((step) => step.key === current);
  const index = foundIndex === -1 ? 0 : foundIndex;
  const accent = tone === "docs" ? "bg-accent-fill" : "bg-accent-2";
  const dot =
    status === "CORRECTION_REQUESTED" || status === "EXCEPTION" || status === "MISSING" || status === "NEEDS_CORRECTION"
      ? "bg-danger"
      : status === "BANK_APPROVED" || status === "DOCUMENTS_DELIVERED" || status === "DELIVERED_TO_CUSTOMER"
        ? "bg-ok"
        : status === "ARRIVED_PORT" || status === "ON_HOLD" || status === "PENDING"
          ? "bg-warn"
          : tone === "docs"
            ? "bg-accent-fill"
            : "bg-accent-2";
  const columns =
    steps.length >= 5 ? "sm:grid-cols-5" : steps.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card" aria-label={title}>
      <div className={cn("flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-white", accent)}>
        <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-white/15">
            {tone === "docs" ? <FileCheck2 className="h-4 w-4" aria-hidden /> : <Ship className="h-4 w-4" aria-hidden />}
          </span>
          <span className="truncate">{title}</span>
        </h2>
        {status ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-accent-2">
            <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dot)} />
            {tx(`status.${status}`, status.replaceAll("_", " "))}
          </span>
        ) : null}
      </div>
      <ol className={cn("grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4", columns)}>
        {steps.map((step, stepIndex) => {
          const done = stepIndex < index;
          const active = foundIndex === -1 ? stepIndex === 0 : step.key === current;
          return (
            <li key={step.key} className="min-w-0" aria-current={active ? "step" : undefined}>
              <span
                aria-hidden
                className={cn(
                  "block rounded-full transition-colors duration-[180ms] ease-out",
                  active ? "h-2" : "h-1.5",
                  done || active ? accent : "bg-line",
                )}
              />
              <p
                className={cn(
                  "mt-2 text-xs leading-snug",
                  active ? "font-semibold text-ink" : done ? "text-ink" : "text-ink-muted",
                )}
              >
                {step.label}
              </p>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-line bg-paper/40 px-4 py-2.5 text-xs leading-relaxed text-ink-muted">{hint}</p>
    </section>
  );
}

export function QueueBand({
  title,
  tone,
  children,
  empty,
}: {
  title: string;
  tone: "urgent" | "today" | "upcoming";
  children: ReactNode;
  empty: ReactNode;
}) {
  const bar = tone === "urgent" ? "bg-danger-fill" : tone === "today" ? "bg-warn" : "bg-accent-fill";
  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className={cn("h-2.5 w-2.5 rounded-full", bar)} aria-hidden />
        <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
      </div>
      <div className="border-t border-line px-4 py-3">{children ?? empty}</div>
    </section>
  );
}
