"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { EditorTipoEquipamento } from "@/components/cadastros/editores/editor-tipo-equipamento";

const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Tipos de equipamento no padrão: inativar/reativar de verdade (antes “Remover” não sumia), impacto antes de inativar. */
export function TiposEquipamentoTela() {
  return (
    <CadastroPadrao
      entidade="tipos-equipamento"
      Editor={EditorTipoEquipamento}
      ajuda="Tipos de equipamento e os formulários de cada tipo de OS. Inativar tira o tipo das novas escolhas; os equipamentos que já são dele continuam como estão."
      celula={(col, t) => {
        if (col === "nome") return (
          <span className="font-medium">{t.nome}{t.chaveEnum && <span className="ml-2 text-[10px] font-semibold bg-surface-alt text-ink-muted px-1.5 py-0.5 rounded">padrão</span>}</span>
        );
        if (col === "descricao") return t.descricao || "—";
        if (col === "uso") {
          const partes = [t._count?.equipamentos && pl(t._count.equipamentos, "equipamento", "equipamentos"), t._count?.formTypeMappings && pl(t._count.formTypeMappings, "formulário", "formulários")].filter(Boolean);
          return partes.length ? partes.join(" · ") : "—";
        }
        return undefined;
      }}
    />
  );
}
