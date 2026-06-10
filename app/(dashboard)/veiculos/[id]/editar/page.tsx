import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { VeiculoForm } from "@/components/forms/veiculo-form";

export const metadata: Metadata = { title: "Editar Veículo" };

export default async function EditarVeiculoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const veiculo = await prisma.veiculo.findFirst({
    where: { id, empresaId },
    include: {
      documentos: { orderBy: { criadoEm: "asc" } },
      manutencoes: { orderBy: { dataRealizacao: "desc" } },
      checklists: {
        orderBy: { criadoEm: "desc" },
        include: {
          colaborador: { select: { nome: true } },
          itens: { where: { alerta: true }, include: { itemTemplate: { select: { descricao: true } } } },
        },
      },
    },
  });
  if (!veiculo) notFound();

  // Ocorrências de alertas por item (alertas recorrentes)
  const contagem = new Map<string, number>();
  for (const c of veiculo.checklists) {
    for (const it of c.itens) {
      const desc = it.itemTemplate.descricao;
      contagem.set(desc, (contagem.get(desc) ?? 0) + 1);
    }
  }
  const ocorrencias = Array.from(contagem.entries())
    .map(([descricao, count]) => ({ descricao, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const initialData = {
    ...veiculo,
    proximaRevisaoData: veiculo.proximaRevisaoData ? veiculo.proximaRevisaoData.toISOString() : null,
    seguroVencimento: veiculo.seguroVencimento ? veiculo.seguroVencimento.toISOString() : null,
    manutencoes: veiculo.manutencoes.map((m) => ({
      ...m,
      custo: m.custo != null ? Number(m.custo) : null,
      dataRealizacao: m.dataRealizacao.toISOString(),
      proximaData: m.proximaData ? m.proximaData.toISOString() : null,
    })),
    documentos: veiculo.documentos.map((d) => ({
      tipo: d.tipo, nome: d.nome, arquivoUrl: d.arquivoUrl,
      dataVencimento: d.dataVencimento ? d.dataVencimento.toISOString() : null,
    })),
    checklists: veiculo.checklists.map((c) => ({
      id: c.id, status: c.status, criadoEm: c.criadoEm.toISOString(),
      colaborador: c.colaborador ? { nome: c.colaborador.nome } : null,
    })),
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title={`Veículo ${veiculo.placa}`} description={[veiculo.marca, veiculo.modelo].filter(Boolean).join(" ")} backHref="/veiculos" />
      <VeiculoForm initialData={initialData} ocorrencias={ocorrencias} />
    </div>
  );
}
