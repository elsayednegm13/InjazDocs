import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function DataFrame({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className="hidden overflow-hidden rounded-card border border-line bg-card shadow-card lg:block">
      <div className="overflow-x-auto">
        <table className={cn("w-full text-sm", className)} aria-label={label}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function DataHead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-paper/80 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
      <tr>{children}</tr>
    </thead>
  );
}

export function DataHeadCell({ children, align, className }: { children: ReactNode; align?: "end"; className?: string }) {
  return (
    <th scope="col" className={cn("px-4 py-3 text-start", align === "end" && "text-end", className)}>
      {children}
    </th>
  );
}

export function DataRow({
  children,
  selected = false,
  onClick,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "border-t border-line/70 transition duration-[180ms] ease-out",
        selected ? "bg-accent/5" : "hover:bg-paper/60",
        onClick && "cursor-pointer",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function DataCell({ children, align, className }: { children?: ReactNode; align?: "end"; className?: string }) {
  return <td className={cn("px-4 py-3", align === "end" && "text-end", className)}>{children}</td>;
}

export function DataCards({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 lg:hidden">{children}</div>;
}

export function DataCard({
  title,
  meta,
  badge,
  children,
  href,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">{title}</div>
          {meta ? <div className="mt-0.5 truncate text-xs text-ink-muted">{meta}</div> : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </>
  );
  const frame = cn(
    "block rounded-card border border-line bg-card p-4 shadow-card transition duration-[180ms] ease-out hover:border-accent/40",
    className,
  );
  if (href) return <Link className={frame} to={href}>{body}</Link>;
  return <div className={frame}>{body}</div>;
}
