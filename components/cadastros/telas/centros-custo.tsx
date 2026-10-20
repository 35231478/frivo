"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";

/** Centros de custo no padrão: criar/editar/inativar/reativar, nome único na empresa, impacto antes de inativar. */
export function CentrosCustoTela() {
  return (
    <CadastroPadrao
      entidade="centros-custo"
      ajuda="Onde cada despesa pesa (ex.: uma obra, a frota, o administrativo). Toda conta a pagar pode ter um; na nota de compra, o último escolhido para o fornecedor já vem preenchido. Inativar tira o centro das contas novas; as que já usam continuam com ele."
      celula={(col, c) => {
        if (col === "uso") return c._count?.contasPagar ? `${c._count.contasPagar} conta(s)` : "—";
        return undefined;
      }}
    />
  );
}
