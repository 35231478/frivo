import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistPreenchimento } from "@/components/veiculos/checklist-preenchimento";

export const metadata: Metadata = { title: "Checklist de Veículo" };

export default async function ChecklistVeiculoPage({ searchParams }: { searchParams: Promise<{ veiculoId?: string }> }) {
  const { veiculoId = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [veiculos, templates, colaboradores] = await Promise.all([
    prisma.veiculo.findMany({ where: { empresaId, status: { not: "INATIVO" } }, select: { id: true, placa: true, modelo: true }, orderBy: { placa: "asc" } }),
    prisma.checklistTemplate.findMany({ where: { empresaId, ativo: true }, include: { itens: { orderBy: { ordem: "asc" } } }, orderBy: { nome: "asc" } }),
    prisma.tecnico.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Checklist de Veículo" description="Preencha o checklist do veículo" backHref="/veiculos" />
      <ChecklistPreenchimento
        veiculos={veiculos}
        templates={templates}
        colaboradores={colaboradores}
        veiculoInicial={veiculoId}
      />
    </div>
  );
}
