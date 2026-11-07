import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-control border border-line bg-card px-3 text-sm shadow-sm transition duration-[180ms] ease-out hover:border-accent/40 focus-visible:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full rounded-control border border-line bg-card px-3 py-2 text-sm shadow-sm transition duration-[180ms] ease-out hover:border-accent/40 focus-visible:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-10 w-full cursor-pointer rounded-control border border-line bg-card px-3 text-sm shadow-sm transition duration-[180ms] ease-out hover:border-accent/40 focus-visible:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  error,
  hint,
  errorId,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
  errorId?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      {error ? (
        <span id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}
