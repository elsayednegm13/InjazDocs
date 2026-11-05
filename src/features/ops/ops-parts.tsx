import { type ReactNode } from "react";
import { CONTAINER_JOURNEY, containerJourneyIndex } from "@shared/container-flow";
import { Button } from "@/components/ui/button";

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border-accent bg-accent/10 text-accent hover:bg-accent/10"
          : "rounded-full border-line bg-paper/60 text-ink-muted hover:border-accent/40 hover:bg-paper/60 hover:text-accent"
      }
    >
      {children}
    </Button>
  );
}

export function JourneyRail({ status }: { status: string }) {
  const index = containerJourneyIndex(status);
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {CONTAINER_JOURNEY.map((step, stepIndex) => (
        <span key={step} className={`h-1.5 w-3.5 rounded-full transition-colors ${stepIndex <= index ? "bg-accent" : "bg-line"}`} />
      ))}
    </div>
  );
}
