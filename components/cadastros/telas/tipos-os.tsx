"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";

const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Tipos de OS no padrão: abas Ativos / Inativos / Todos, busca, Novo / Editar / Inativar conforme a
 * permissão, impacto antes de inativar e cartões no celular (antes era uma tabela própria, sem nada disso).
 */
export function TiposOsTela() {
  return (
    <CadastroPadrao
      entidade="tipos-os"
      ajuda="Os tipos de serviço que a empresa executa. Cada atividade de uma OS tem um tipo: ele define a cor na agenda, os formulários e se a conclusão exige equipamento. Inativar um tipo o retira das novas escolhas; as OS já lançadas não mudam."
      celula={(col, t) => {
        if (col === "descricao") return t.descricao || "—";
        if (col === "exigeEquipamento") return t.exigeEquipamento === false
          ? <span data-exige-equipamento="nao" className="text-xs font-semibold text-atencao-texto bg-atencao-claro border border-atencao/20 px-2 py-0.5 rounded-full whitespace-nowrap">Não exige</span>
          : <span data-exige-equipamento="sim" className="text-xs font-medium text-ink-muted whitespace-nowrap">Exige para concluir</span>;
        if (col === "uso") return t._count?.atividades ? pl(t._count.atividades, "atividade", "atividades") : "—";
        return undefined;
      }}
    />
  );
}
