"use client";

import { FileSignature } from "lucide-react";
import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { EditorModeloDocumento } from "@/components/cadastros/editores/editor-modelo-documento";
import { rotuloTipo } from "@/lib/documentos/modelos";

/** Modelos de documento no padrão da casa: abas, busca, inativar/reativar e o editor próprio. */
export function ModelosDocumentoTela() {
  return (
    <CadastroPadrao
      entidade="modelos-documento"
      Editor={EditorModeloDocumento}
      ajuda="O texto que vira ficha de EPI, termo de responsabilidade, advertência ou aditivo na ficha de alguém. O sistema preenche os campos entre chaves com os dados da pessoa; o papel gerado guarda o texto como estava no dia — mudar o modelo não altera o que já foi entregue."
      celula={(col, m) => {
        if (col === "nome") {
          return (
            <span className="inline-flex items-center gap-2 font-medium">
              <FileSignature className="w-4 h-4 text-primary-600 shrink-0" /> {m.nome as string}
            </span>
          );
        }
        if (col === "tipo") return rotuloTipo(m.tipo as string);
        return undefined;
      }}
    />
  );
}
