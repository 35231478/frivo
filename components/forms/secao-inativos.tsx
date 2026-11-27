"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Inativos (N)" no fim de uma lista de cadastro filho (endereços e contatos do cliente): recolhido por
 * padrão, para a lista do dia a dia mostrar só o que está em uso. Cada linha traz a ação de reativar
 * (o botão padrão dos cadastros, passado por `acao`). Sem inativos, não aparece.
 */
export function SecaoInativos<T extends { id: string; nome: string }>({ itens, detalhe, acao, rotulo = "Inativos" }: {
  itens: T[];
  detalhe?: (item: T) => string | null | undefined;
  acao: (item: T) => React.ReactNode;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  if (!itens.length) return null;
  return (
    <div className="pt-1" data-secao-inativos>
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", !aberto && "-rotate-90")} aria-hidden />
        {rotulo} ({itens.length})
      </button>
      {aberto && (
        <ul className="mt-2 border border-surface-border rounded-lg divide-y divide-surface-border bg-surface-page/50">
          {itens.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2" data-inativo={i.id}>
              <div className="min-w-0">
                <p className="text-sm text-ink-muted truncate">{i.nome}</p>
                {detalhe?.(i) && <p className="text-xs text-ink-subtle truncate">{detalhe(i)}</p>}
              </div>
              {acao(i)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
