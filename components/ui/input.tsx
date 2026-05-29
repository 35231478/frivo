import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  valido?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, valido, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      className={cn(
        "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-all",
        "focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10",
        "disabled:bg-surface-alt disabled:text-ink-muted disabled:cursor-not-allowed",
        "placeholder:text-ink-subtle",
        error
          ? "border-red-400 focus:border-red-500 focus:ring-red-500/10"
          : valido
            ? "border-success-400 focus:border-success-500 focus:ring-success-500/10"
            : "border-surface-border",
        className
      )}
    />
  )
);
Input.displayName = "Input";
