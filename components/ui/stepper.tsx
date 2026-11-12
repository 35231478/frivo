import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Stepper (andamento em etapas): passos feitos e o atual no acento, os seguintes em neutro.
 * Lista ordenada real (<ol>) com aria-current="step" no passo atual. Os data-* (etapa/estado)
 * ficam para os testes e para a tela apontar.
 */
export function Stepper({ passos, atual, rotulo, className, ...dados }: {
  passos: { id: string; rotulo: string }[];
  /** Índice do passo atual; -1 = nenhum (todos futuros) */
  atual: number;
  /** aria-label da lista */
  rotulo: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <ol {...dados} aria-label={rotulo} className={cn("grid gap-1.5", className)} style={{ gridTemplateColumns: `repeat(${passos.length}, minmax(0, 1fr))` }}>
      {passos.map((p, i) => {
        const feito = i < atual;
        const agora = i === atual;
        return (
          <li key={p.id} data-etapa={p.id} data-estado={agora ? "atual" : feito ? "feito" : "futuro"} aria-current={agora ? "step" : undefined} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", feito || agora ? "bg-acento" : "bg-surface-linha")} />
            <p className={cn("mt-1.5 text-[10px] sm:text-xs truncate flex items-center gap-1",
              agora ? "font-semibold text-acento" : feito ? "text-ink" : "text-ink-muted")}>
              {feito && <Check className="hidden sm:block w-3 h-3 shrink-0 text-acento" aria-hidden="true" />}
              {p.rotulo}
              {feito && <span className="sr-only">(feito)</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
