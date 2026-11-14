import type { Metadata } from "next";
import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { ChecklistTemplatesClient } from "@/components/config/checklist-templates-client";

export const metadata: Metadata = { title: "Checklists de veículo" };

/** Frota › Checklists: quem entra é quem tem Frota (moduloDaRota); gravar exige Configurações ou Frota › gerenciar. */
export default function ChecklistsVeiculoPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <TelaCadastroApoio titulo="Checklists de veículo" descricao="Modelos de checklist preenchidos pelos colaboradores" voltar="/veiculos">
        <ChecklistTemplatesClient />
      </TelaCadastroApoio>
    </div>
  );
}
