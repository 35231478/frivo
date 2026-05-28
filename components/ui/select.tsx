import { cn } from "@/lib/utils";
import type { SelectHTMLAttributes } from "react";
import { forwardRef } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, placeholder, children, ...props }, ref) => (
    <select
      ref={ref}
      {...props}
      className={cn(
        "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-all",
        "focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10",
        "disabled:bg-surface-alt disabled:text-ink-muted disabled:cursor-not-allowed",
        error
          ? "border-red-400 focus:border-red-500 focus:ring-red-500/10"
          : "border-surface-border",
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  )
);
Select.displayName = "Select";
