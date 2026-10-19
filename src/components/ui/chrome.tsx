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
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]", className)}>
      {title ? <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink">{title}</h2> : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  href,
  hint,
  icon,
}: {
  label: string;
  value: number;
  href?: string;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-ink-muted">{label}</div>
          <div className="mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight text-ink">
            <Ltr>{value}</Ltr>
          </div>
        </div>
        {icon ? <span className="grid h-9 w-9 place-items-center rounded-full bg-paper text-accent">{icon}</span> : null}
      </div>
      {hint ? <p className="mt-2 text-xs text-ink-muted">{hint}</p> : null}
    </>
  );
  const className = "block rounded-[14px] border border-line bg-card px-4 py-4 shadow-[var(--shadow-card)]";
  if (!href) return <div className={className}>{body}</div>;
  return (
    <Link className={`${className} transition hover:border-accent/40`} to={href}>
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
