import type { Metadata } from "next";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { ChecklistTemplatesClient } from "@/components/config/checklist-templates-client";

export const metadata: Metadata = { title: "Checklists de veículo" };

/** Frota › Checklists: quem entra é quem tem Frota (moduloDaRota); gravar exige Configurações ou Frota › gerenciar. */
export default async function ChecklistsVeiculoPage() {
  // Frota desligada: a tela dos modelos de checklist vai junto (é parte do módulo)
  await exigirModuloNaPagina("veiculos");

  return (
    <div className="max-w-5xl mx-auto">
      <TelaCadastroApoio titulo="Checklists de veículo" descricao="Modelos de checklist preenchidos pelos colaboradores" voltar="/veiculos">
        <ChecklistTemplatesClient />
      </TelaCadastroApoio>
    </div>
  );
}
