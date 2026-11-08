"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PilulaComportamento } from "@/components/estoque/categoria-produto";
import { ehComportamento } from "@/lib/estoque/categoria";

/**
 * Categorias de produto no padrão: nome + comportamento de faturamento (venda à parte / incluso no
 * serviço). As duas do Zé vêm pré-cadastradas em toda empresa; ele cria outras à vontade.
 */
export function CategoriasProdutoTela() {
  return (
    <CadastroPadrao
      entidade="categorias-produto"
      ajuda="Define como o produto entra na cobrança: “Venda à parte” (peça cobrada separada, baixa estoque) ou “Incluso no serviço” (material embutido no valor, só baixa estoque). Sem categoria, o produto é tratado como incluso."
      celula={(col, c) => {
        if (col === "comportamento") return ehComportamento(c.comportamento) ? <PilulaComportamento comportamento={c.comportamento} /> : "—";
        if (col === "uso") return c._count?.produtos ? `${c._count.produtos} produto(s)` : "—";
        return undefined;
      }}
    />
  );
}
