"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";

/** Contas bancárias no padrão: criar/editar/inativar/reativar, nome único na empresa, impacto antes de inativar. */
export function ContasBancariasTela() {
  return (
    <CadastroPadrao
      entidade="contas-bancarias"
      ajuda="Onde o dinheiro entra. Escolhida na cobrança (conta a receber) e na baixa do recebimento. Inativar a conta a retira das cobranças novas; as existentes permanecem vinculadas."
      celula={(col, c) => {
        if (col === "agconta") return [c.agencia, c.conta].filter(Boolean).join(" / ") || "—";
        if (col === "uso") return c._count?.contasReceber ? `${c._count.contasReceber} conta(s)` : "—";
        return undefined;
      }}
    />
  );
}
