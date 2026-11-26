import type { Metadata } from "next";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { ChecklistTemplatesClient } from "@/components/config/checklist-templates-client";
import { ChecklistDiarioConfig } from "@/components/config/checklist-diario-config";
import { carregarConfigDiario } from "@/lib/checklist-diario/servidor";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";

export const metadata: Metadata = { title: "Checklists de veículo" };

/** Frota › Checklists: quem entra é quem tem Frota (moduloDaRota); gravar exige Configurações ou Frota › gerenciar. */
export default async function ChecklistsVeiculoPage() {
  // Frota desligada: a tela dos modelos de checklist vai junto (é parte do módulo)
  const session = await exigirModuloNaPagina("veiculos");
  const u = session!.user!;
  // Checklist obrigatório no app (o "porteiro"): a configuração da empresa, os modelos ativos e quem tem veículo padrão
  const [config, modelos, colaboradores] = await Promise.all([
    carregarConfigDiario(u.empresaId),
    prisma.checklistTemplate.findMany({ where: { empresaId: u.empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.tecnico.findMany({ where: { empresaId: u.empresaId, ativo: true }, select: { id: true, nome: true, veiculoPadrao: { select: { placa: true } } }, orderBy: { nome: "asc" } }),
  ]);
  const podeGerenciar = pode(u.permissoes, "configuracoes", "gerenciar", u.role) || pode(u.permissoes, "veiculos", "gerenciar", u.role);

  return (
    <div className="max-w-5xl mx-auto">
      <TelaCadastroApoio titulo="Checklists de veículo" descricao="Modelos de checklist preenchidos pelos colaboradores" voltar="/veiculos">
        <ChecklistDiarioConfig inicial={config} modelos={modelos} podeGerenciar={podeGerenciar}
          colaboradores={colaboradores.map((c) => ({ id: c.id, nome: c.nome, veiculo: c.veiculoPadrao?.placa ?? null }))} />
        <ChecklistTemplatesClient />
      </TelaCadastroApoio>
    </div>
  );
}
