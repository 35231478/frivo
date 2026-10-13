"use client";

import { FileText } from "lucide-react";
import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { EditorTermo } from "@/components/cadastros/editores/editor-termo";

/** Termos de referência no padrão: inativar/reativar (antes só “Desativar”, sem volta). */
export function TermosReferenciaTela() {
  return (
    <CadastroPadrao
      entidade="termos-referencia"
      Editor={EditorTermo}
      ajuda="Modelos de termo usados nas propostas de contrato, com variáveis automáticas. A proposta copia o texto: inativar um termo não muda as propostas já feitas."
      celula={(col, t) => {
        if (col === "nome") return <span className="inline-flex items-center gap-2 font-medium"><FileText className="w-4 h-4 text-primary-600 shrink-0" /> {t.nome}</span>;
        if (col === "descricao") return t.descricao || "—";
        return undefined;
      }}
    />
  );
}
