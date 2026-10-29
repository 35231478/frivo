import { cn } from "@/lib/utils";
import { cloneElement, isValidElement, useId, type ReactNode } from "react";
import { Dica } from "@/components/ui/dica";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  /** Explicação longa do campo: vai para o ⓘ ao lado do rótulo (Princípio 7) */
  dica?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, error, required, hint, dica, className, children }: FormFieldProps) {
  // UX-8 (G2): label ASSOCIADO ao campo (a11y + clique no rótulo foca o campo + automação).
  // Quando o filho é um elemento único sem id, ele ganha o id gerado; filhos compostos ficam como estão.
  const idGerado = useId();
  const filhoUnico = isValidElement<{ id?: string }>(children) ? children : null;
  const id = filhoUnico ? (filhoUnico.props.id ?? idGerado) : undefined;
  const campo = filhoUnico && !filhoUnico.props.id ? cloneElement(filhoUnico, { id }) : children;
  const rotulo = (
    <label htmlFor={id} className="text-sm font-medium text-ink">
      {label}
      {required && <span className="text-atrasado ml-0.5">*</span>}
    </label>
  );
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/* Com dica, o ⓘ fica ao lado do rótulo e FORA do <label> (não entra no nome do campo nem o foca) */}
      {dica ? (
        <div className="flex items-center gap-1">{rotulo}<Dica texto={dica} rotulo={label} lado="direita" /></div>
      ) : rotulo}
      {campo}
      {hint && !error && <p className="text-xs text-ink-muted">{hint}</p>}
      {error && <p className="text-xs text-atrasado font-medium">{error}</p>}
    </div>
  );
}

export function FormSection({ title, icon, dica, children }: { title: string; icon?: ReactNode; dica?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-muted uppercase tracking-wider pb-2 border-b border-surface-border">
        {icon && <span className="text-acento">{icon}</span>}
        {title}
        {dica && <Dica texto={dica} rotulo={title} lado="direita" />}
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
