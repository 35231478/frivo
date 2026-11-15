import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistTela } from "@/components/veiculos/checklist-tela";

export const metadata: Metadata = { title: "Checklist de veículo" };

const AJUDA = "Preencha o checklist do veículo. Em Preenchidos ficam os já enviados, com detalhe, edição e exclusão conforme a permissão.";

export default async function ChecklistVeiculoPage({ searchParams }: { searchParams: Promise<{ veiculoId?: string; aba?: string }> }) {
  const { veiculoId = "", aba = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [veiculos, templates, colaboradores] = await Promise.all([
    prisma.veiculo.findMany({ where: { empresaId, status: { not: "INATIVO" } }, select: { id: true, placa: true, modelo: true }, orderBy: { placa: "asc" } }),
    prisma.checklistTemplate.findMany({ where: { empresaId, ativo: true }, include: { itens: { where: { ativo: true }, orderBy: { ordem: "asc" } } }, orderBy: { nome: "asc" } }),
    prisma.tecnico.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Checklist de veículo" dica={AJUDA} backHref="/veiculos" />
      <ChecklistTela veiculos={veiculos} templates={templates} colaboradores={colaboradores} veiculoInicial={veiculoId} abaInicial={aba} />
    </div>
  );
}
