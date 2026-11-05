import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-control px-3 text-sm font-medium transition duration-[180ms] ease-out active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
  {
    variants: {
      variant: {
        default: "bg-accent-fill text-white shadow-sm hover:brightness-110",
        outline: "border border-line bg-card text-ink shadow-sm hover:bg-paper",
        ghost: "hover:bg-ink/10",
        danger: "bg-danger-fill text-white hover:brightness-110",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-11 px-4",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
