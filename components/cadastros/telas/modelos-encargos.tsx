"use client";

import { Star } from "lucide-react";
import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { EditorModeloEncargos } from "@/components/cadastros/editores/editor-modelo-encargos";
import { REGIME_LABEL, somaPercentuais, type ItemEncargo, type Regime } from "@/lib/folha/calculo";

/** Modelos de encargos no padrão: inativar/reativar (nunca apaga), impacto antes de inativar. */
export function ModelosEncargosTela() {
  return (
    <CadastroPadrao
      entidade="modelos-encargos"
      Editor={EditorModeloEncargos}
      celula={(col, m) => {
        if (col === "nome") return (
          <span className="flex items-center gap-1.5 font-medium">
            {m.nome}{m.padrao && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" aria-label="Padrão do tipo de contrato" />}
          </span>
        );
        if (col === "regime") return `${REGIME_LABEL[m.regime as Regime] ?? m.regime}${m.padrao ? " · padrão" : ""}`;
        if (col === "total") return <span className="tabular-nums">{somaPercentuais((Array.isArray(m.itens) ? m.itens : []) as ItemEncargo[]).toLocaleString("pt-BR")}%</span>;
        if (col === "uso") return m._count?.colaboradores ? `${m._count.colaboradores} colaborador(es)` : "—";
        return undefined;
      }}
    />
  );
}
