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
        "w-full border rounded-lg px-3 py-2 text-sm bg-white transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-frivo-500 focus:border-frivo-500",
        "disabled:opacity-50 disabled:bg-gray-50",
        error ? "border-red-400 focus:ring-red-300" : "border-gray-300",
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  )
);
Select.displayName = "Select";
