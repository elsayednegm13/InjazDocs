import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";

export function FormDisclosure({
  open,
  onToggle,
  title,
  hint,
  openLabel,
  closeLabel,
  embedded = false,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  hint?: ReactNode;
  openLabel: string;
  closeLabel: string;
  embedded?: boolean;
  children: ReactNode;
}) {
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p> : null}
      </div>
      <Button type="button" size="sm" variant="outline" className="shrink-0" aria-expanded={open} onClick={onToggle}>
        {open ? closeLabel : openLabel}
      </Button>
    </div>
  );
  const body = (
    <Reveal open={open}>
      <div className={embedded ? "mt-4 border-t border-line pt-4" : "border-t border-line p-4"}>{children}</div>
    </Reveal>
  );
  if (embedded) {
    return (
      <div>
        {header}
        {body}
      </div>
    );
  }
  return (
    <section className="rounded-card border border-line bg-card shadow-card">
      <div className="p-4">{header}</div>
      {body}
    </section>
  );
}
