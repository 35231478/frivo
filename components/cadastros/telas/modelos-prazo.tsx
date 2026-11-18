"use client";

import { Clock } from "lucide-react";
import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { EditorModeloPrazo } from "@/components/cadastros/editores/editor-modelo-prazo";

/** Modelos de etapas com prazo no padrão: inativar/reativar, impacto (etapas em andamento nas OS). */
export function ModelosPrazoTela() {
  return (
    <CadastroPadrao
      entidade="modelos-prazo"
      Editor={EditorModeloPrazo}
      ajuda="Sequências de etapas com responsável e prazo (por exemplo: cotar a peça, comprar, receber), usadas em “Adicionar etapas” na OS. Não é o prazo da OS nem o prazo de atendimento do contrato. Inativar um modelo o retira das novas seleções; as etapas em andamento continuam valendo."
      celula={(col, m) => {
        if (col === "etapas") {
          const n = Array.isArray(m.etapas) ? m.etapas.length : 0;
          return <span className="inline-flex items-center gap-1 text-ink-muted"><Clock className="w-3.5 h-3.5" /> {n} etapa{n === 1 ? "" : "s"}</span>;
        }
        if (col === "uso") return m._count?.osPrazos ? `${m._count.osPrazos} prazo(s) em OS` : "—";
        return undefined;
      }}
    />
  );
}
