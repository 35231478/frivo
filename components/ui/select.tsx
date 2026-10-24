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
        "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-colors",
        "focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15",
        "disabled:bg-surface-page disabled:text-ink-muted disabled:cursor-not-allowed",
        error
          ? "border-atrasado focus:border-atrasado focus:ring-atrasado/15"
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
