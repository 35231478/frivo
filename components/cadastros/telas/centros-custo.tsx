"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";

/** Centros de custo no padrão: criar/editar/inativar/reativar, nome único na empresa, impacto antes de inativar. */
export function CentrosCustoTela() {
  return (
    <CadastroPadrao
      entidade="centros-custo"
      ajuda="Alocação das despesas (ex.: obra, frota, administrativo). Disponível em toda conta a pagar; na nota de compra, é sugerido o último centro usado com o fornecedor. Inativar um centro o retira das contas novas; as existentes permanecem vinculadas."
      celula={(col, c) => {
        if (col === "uso") return c._count?.contasPagar ? `${c._count.contasPagar} conta(s)` : "—";
        return undefined;
      }}
    />
  );
}
