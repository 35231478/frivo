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
        "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-colors",
        "focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15",
        "disabled:bg-surface-page disabled:text-ink-muted disabled:cursor-not-allowed",
        "placeholder:text-ink-subtle",
        error
          ? "border-atrasado focus:border-atrasado focus:ring-atrasado/15"
          : valido
            ? "border-ok focus:border-ok focus:ring-ok/15"
            : "border-surface-border",
        className
      )}
    />
  )
);
Input.displayName = "Input";
