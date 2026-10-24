import { cn } from "@/lib/utils";
import { cloneElement, isValidElement, useId, type ReactNode } from "react";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, error, required, hint, className, children }: FormFieldProps) {
  // UX-8 (G2): label ASSOCIADO ao campo (a11y + clique no rótulo foca o campo + automação).
  // Quando o filho é um elemento único sem id, ele ganha o id gerado; filhos compostos ficam como estão.
  const idGerado = useId();
  const filhoUnico = isValidElement<{ id?: string }>(children) ? children : null;
  const id = filhoUnico ? (filhoUnico.props.id ?? idGerado) : undefined;
  const campo = filhoUnico && !filhoUnico.props.id ? cloneElement(filhoUnico, { id }) : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-atrasado ml-0.5">*</span>}
      </label>
      {campo}
      {hint && !error && <p className="text-xs text-ink-muted">{hint}</p>}
      {error && <p className="text-xs text-atrasado font-medium">{error}</p>}
    </div>
  );
}

export function FormSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-muted uppercase tracking-wider pb-2 border-b border-surface-border">
        {icon && <span className="text-acento">{icon}</span>}
        {title}
      </h3>
      {children}
    </div>
  );
}

export function FormGrid({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div className={cn("grid gap-4", cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
      {children}
    </div>
  );
}
