import type { ReactNode } from "react";

export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out ${open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"}`}
      inert={open ? undefined : true}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
