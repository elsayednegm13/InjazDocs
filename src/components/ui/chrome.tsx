import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusBadge } from "@/components/ui/status";
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
    <section className={cn("rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]", className)}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
            {icon ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">{icon}</span> : null}
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
  blue: { card: "border-[#dbe7f8] bg-[#f4f8ff]", chip: "bg-[#dceafe] text-[#2563eb]" },
  teal: { card: "border-[#cfeee8] bg-[#f2fbf9]", chip: "bg-[#d3f3ee] text-accent" },
  amber: { card: "border-[#f7e5c3] bg-[#fffaf1]", chip: "bg-[#fbeccd] text-[#a16207]" },
  green: { card: "border-[#d8eedd] bg-[#f3fbf5]", chip: "bg-[#daf3e0] text-ok" },
  rose: { card: "border-[#f6d9d5] bg-[#fff6f5]", chip: "bg-[#fbe1de] text-danger" },
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
  value: number;
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
        {icon ? <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", palette.chip)}>{icon}</span> : null}
      </div>
      {hint ? <p className="mt-2.5 line-clamp-2 text-[11px] leading-snug text-ink-muted">{hint}</p> : null}
    </>
  );
  const className = cn("block rounded-2xl border px-4 py-4 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-tower)]", palette.card);
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

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line bg-paper/60 px-4 py-6 text-sm text-ink-muted">{children}</p>;
}

export function AlertText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-paper px-3 py-2 text-sm text-danger">
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
  const index = Math.max(0, steps.findIndex((step) => step.key === current));
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)]" aria-label={title}>
      <div className={cn("px-4 py-3 text-white", tone === "docs" ? "bg-accent" : "bg-ink")}>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="px-4 pt-3">{status ? <StatusBadge value={status} /> : null}</div>
      <ol className="grid grid-cols-2 gap-x-3 gap-y-3 px-4 py-4 sm:flex sm:overflow-x-auto">
        {steps.map((step, stepIndex) => {
          const done = stepIndex < index;
          const active = step.key === current || (index === -1 && stepIndex === 0);
          return (
            <li key={step.key} className="min-w-0 sm:min-w-24 sm:flex-1" aria-current={active ? "step" : undefined}>
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  done || active ? (tone === "docs" ? "bg-accent" : "bg-ink") : "bg-line",
                )}
              />
              <p className={cn("mt-2 text-xs leading-snug", active ? "font-semibold text-ink" : "text-ink-muted")}>{step.label}</p>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-line px-4 py-3 text-sm text-ink">{hint}</p>
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
  const bar = tone === "urgent" ? "bg-danger" : tone === "today" ? "bg-warn" : "bg-accent";
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className={cn("h-2.5 w-2.5 rounded-full", bar)} aria-hidden />
        <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
      </div>
      <div className="border-t border-line px-4 py-3">{children ?? empty}</div>
    </section>
  );
}
