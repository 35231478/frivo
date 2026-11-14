"use client";

import { cn } from "@/lib/utils";

/**
 * As abas de situação de uma lista (Ativos / Inativos / Todos) — o mesmo seletor em todo cadastro.
 * `contagem` mostra o total de cada aba entre parênteses (null = ainda carregando); sem ela, só o nome.
 */
export function AbasSituacao<T extends string>({ abas, valor, onChange, contagem, rotulo, className }: {
  abas: readonly { id: T; label: string }[];
  valor: T;
  onChange: (aba: T) => void;
  contagem?: Record<T, number> | null;
  /** Nome acessível do grupo de abas */
  rotulo?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 rounded-lg border border-surface-border p-0.5 bg-surface-alt sm:flex-none", className)} role="tablist" aria-label={rotulo}>
      {abas.map((a) => (
        <button
          key={a.id} type="button" role="tab" aria-selected={valor === a.id} data-aba={a.id}
          onClick={() => onChange(a.id)}
          className={cn("flex-1 sm:flex-none px-2 sm:px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
            valor === a.id ? "bg-white text-primary-700 shadow-sm" : "text-ink-muted hover:text-ink")}
        >
          {a.label}{contagem !== undefined && <> <span className="text-xs text-ink-subtle tabular-nums">({contagem ? contagem[a.id].toLocaleString("pt-BR") : "…"})</span></>}
        </button>
      ))}
    </div>
  );
}

export type AbaAtivosInativos = "ativos" | "inativos";
export const ABAS_ATIVOS_INATIVOS: readonly { id: AbaAtivosInativos; label: string }[] = [{ id: "ativos", label: "Ativos" }, { id: "inativos", label: "Inativos" }];
