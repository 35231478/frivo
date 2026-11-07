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
      ajuda="A categoria diz como o produto entra na cobrança: “Venda à parte” (peça de reposição: cobra separado e baixa estoque) ou “Incluso no serviço” (material de instalação/consumo: embutido no valor, só baixa estoque). Produto sem categoria é tratado como incluso. Inativar uma categoria a tira das novas escolhas; os produtos que já a usam continuam vinculados."
      celula={(col, c) => {
        if (col === "comportamento") return ehComportamento(c.comportamento) ? <PilulaComportamento comportamento={c.comportamento} /> : "—";
        if (col === "uso") return c._count?.produtos ? `${c._count.produtos} produto(s)` : "—";
        return undefined;
      }}
    />
  );
}
