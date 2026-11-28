import { cn } from "@/lib/utils";
import type { SelectHTMLAttributes } from "react";
import { forwardRef } from "react";
import { propsDoCampo, useCampo } from "@/components/ui/campo-contexto";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error: errorProp, placeholder, children, ...props }, ref) => {
    const { error, ...aria } = propsDoCampo(useCampo(), { error: errorProp, "aria-invalid": props["aria-invalid"], "aria-describedby": props["aria-describedby"] });
    return (
    <select
      ref={ref}
      {...props}
      {...aria}
      className={cn(
        "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-colors",
        "focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15",
        "disabled:bg-surface-page disabled:text-ink-muted disabled:cursor-not-allowed",
        error
          ? "border-atrasado focus:border-atrasado focus:ring-atrasado/15"
          : "border-surface-campo",
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
    );
  }
);
Select.displayName = "Select";
(Select as unknown as { campoDeFormulario: boolean }).campoDeFormulario = true;
