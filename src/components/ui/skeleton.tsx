import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared loading placeholders.
 *
 * The blocks are decorative and hidden from assistive technology. The wrapper
 * carries the busy state, so a screen reader announces one message instead of
 * every block. The animation is disabled through `motion-reduce` for users who
 * ask for less movement.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-lg bg-line/70 motion-reduce:animate-none", className)} />;
}

/** Wraps placeholders and exposes the accessible loading state once. */
export function SkeletonRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonText({ lines = 3, className, widths }: { lines?: number; className?: string; widths?: string[] }) {
  return (
    <div aria-hidden="true" className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn("h-3", widths?.[index] ?? (index === lines - 1 ? "w-2/3" : "w-full"))} />
      ))}
    </div>
  );
}

/** A card shaped like the shared SectionCard, with a heading line and content lines. */
export function SkeletonCard({
  title = true,
  lines = 3,
  className,
  children,
}: {
  title?: boolean;
  lines?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]", className)}>
      {title ? <Skeleton className="mb-3 h-4 w-32" /> : null}
      {children ?? <SkeletonText lines={lines} widths={["w-full", "w-5/6", "w-2/3", "w-4/5", "w-1/2"]} />}
    </div>
  );
}

/** Placeholder for the statistic cards on the dashboard. */
export function SkeletonStats({ count = 4, label }: { count?: number; label?: string }) {
  const grid = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-line bg-card px-4 py-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-12" />
            </div>
            <Skeleton className="h-10 w-10 rounded-xl" />
          </div>
          <Skeleton className="mt-3 h-2.5 w-32" />
        </div>
      ))}
    </div>
  );
  return label ? <SkeletonRegion label={label}>{grid}</SkeletonRegion> : grid;
}

/** Placeholder rows for the list style panels. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border border-line/70 bg-paper/40 px-3 py-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for the desktop table shape: a header row and body rows. */
export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  const widths = ["w-24", "w-32", "w-20", "w-24", "w-16", "w-28", "w-20"];
  return (
    <div aria-hidden="true">
      <div className="grid gap-3 border-b border-line px-3 pb-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className={cn("h-2.5", widths[index % widths.length])} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid items-center gap-3 border-b border-line/60 px-3 py-3.5 last:border-0"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, index) => (
            <Skeleton key={index} className={cn("h-3", widths[(index + rowIndex) % widths.length])} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The raw card list blocks, without the accessible wrapper. */
function CardListBlocks({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          </div>
          <Skeleton className="mt-3 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for the card list used on narrow screens. */
export function SkeletonCardList({ rows = 4, label = "Loading list" }: { rows?: number; label?: string }) {
  return (
    <SkeletonRegion label={label}>
      <CardListBlocks rows={rows} />
    </SkeletonRegion>
  );
}

/** Placeholder for the two column detail layouts. */
export function SkeletonDetails({ cards = 2, rows = 4 }: { cards?: number; rows?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]">
          <Skeleton className="mb-3 h-4 w-28" />
          <div className="space-y-2.5">
            {Array.from({ length: rows }).map((__, rowIndex) => (
              <div key={rowIndex} className="flex items-center justify-between gap-3">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a form whose fields depend on loaded data. */
export function SkeletonForm({ fields = 4, className }: { fields?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("grid gap-4 md:grid-cols-2", className)}>
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/**
 * List pages show a table on wide screens and cards on narrow screens. The
 * placeholder mirrors both so the page does not jump when the data arrives.
 */
export function ResponsiveListSkeleton({ rows = 5, columns = 4, label = "Loading list" }: { rows?: number; columns?: number; label?: string }) {
  return (
    <SkeletonRegion label={label}>
      <div aria-hidden="true">
        <div className="hidden overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)] md:block">
          <div className="p-3">
            <SkeletonTable rows={rows} columns={columns} />
          </div>
        </div>
        <div className="md:hidden">
          <CardListBlocks rows={Math.min(rows, 4)} />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** The export case dossier: a case header, the two lanes, then the panels. */
export function CaseDetailSkeleton() {
  return (
    <SkeletonRegion label="Loading case file" className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </div>
        </div>
        <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((lane) => (
          <div key={lane} className="overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-2 bg-accent-2 px-4 py-3">
              <Skeleton className="h-4 w-32 bg-white/25" />
              <Skeleton className="h-5 w-20 rounded-full bg-white/20" />
            </div>
            <div className="grid grid-cols-2 gap-4 px-4 py-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-1.5 w-full rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <SkeletonDetails cards={2} rows={5} />
    </SkeletonRegion>
  );
}

/** The dashboard placeholder keeps the real section order to avoid a jump. */
export function DashboardSkeleton({ showHero = true }: { showHero?: boolean }) {
  return (
    <SkeletonRegion label="Loading dashboard" className="space-y-5">
      {showHero ? (
        <div className="rounded-2xl bg-accent-2 px-5 py-6">
          <Skeleton className="h-5 w-36 bg-white/15" />
          <Skeleton className="mt-3 h-7 w-56 bg-white/20" />
          <Skeleton className="mt-3 h-3 w-full max-w-md bg-white/10" />
          <Skeleton className="mt-2 h-3 w-2/3 max-w-sm bg-white/10" />
        </div>
      ) : null}
      <SkeletonStats />
      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
      <SkeletonCard lines={4} />
    </SkeletonRegion>
  );
}

/** A generic page placeholder: a heading, a filter row and a list. */
export function PageSkeleton({ cards = 1, rows = 5, label = "Loading content" }: { cards?: number; rows?: number; label?: string }) {
  return (
    <SkeletonRegion label={label} className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <Skeleton className="h-11 w-full rounded-2xl" />
      {Array.from({ length: cards }).map((_, index) => (
        <SkeletonCard key={index} lines={rows} />
      ))}
    </SkeletonRegion>
  );
}
