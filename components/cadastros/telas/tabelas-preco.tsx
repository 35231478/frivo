"use client";

import { Lock, Tags } from "lucide-react";
import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { EditorTabelaPreco } from "@/components/cadastros/editores/editor-tabela-preco";
import { LABELS_TIPO_TABELA_PRECO } from "@/lib/utils";

/** Tabelas de preço no padrão: inativar/reativar, impacto (clientes que voltam para a Padrão). */
export function TabelasPrecoTela() {
  return (
    <CadastroPadrao
      entidade="tabelas-preco"
      Editor={EditorTabelaPreco}
      ajuda="Preços por serviço/produto, vinculados a clientes. Cliente com tabela inativa continua ligado a ela, mas os preços passam a vir da tabela Padrão."
      celula={(col, t) => {
        if (col === "nome") return (
          <span className="inline-flex flex-col">
            <span className="inline-flex items-center gap-2 flex-wrap font-medium">
              <Tags className="w-4 h-4 text-primary-600 shrink-0" /> {t.nome}
              {t.precosBloqueados && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"><Lock className="w-3 h-3" /> Bloqueada</span>}
            </span>
            {t.descricao && <span className="text-xs text-ink-subtle font-normal mt-0.5">{t.descricao}</span>}
          </span>
        );
        if (col === "tipo") return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">{LABELS_TIPO_TABELA_PRECO[t.tipo] ?? t.tipo}</span>;
        if (col === "itens") return <span className="tabular-nums">{t._count?.itens ?? 0}</span>;
        if (col === "uso") return t._count?.clientes ? `${t._count.clientes} cliente(s)` : "—";
        return undefined;
      }}
    />
  );
}
