import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrcamentoForm } from "@/components/forms/orcamento-form";

export const metadata: Metadata = { title: "Editar Orçamento" };

export default async function EditarOrcamentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id, empresaId },
    include: {
      servicos: { orderBy: { ordem: "asc" } },
      produtos: { orderBy: { ordem: "asc" } },
      ordensServico: {
        include: {
          ordemServico: { select: { id: true, numero: true, descricao: true, status: true } },
        },
      },
    },
  });
  if (!orcamento) notFound();

  if (orcamento.status !== "RASCUNHO") {
    redirect(`/orcamentos/${id}`);
  }

  const [clientes, servicos, produtos, tecnicos, termoTemplates] = await Promise.all([
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
    prisma.servico.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, descricao: true, unidade: true, valorPadrao: true },
      orderBy: { nome: "asc" },
    }),
    prisma.produto.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, descricao: true, unidade: true, valorPadrao: true },
      orderBy: { nome: "asc" },
    }),
    prisma.tecnico.findMany({
      where: { empresaId, ativo: true, tipo: "RESPONSAVEL_TECNICO" },
      select: { id: true, nome: true, crea: true },
      orderBy: { nome: "asc" },
    }),
    prisma.termoReferenciaTemplate.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, conteudo: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const inicial = {
    id: orcamento.id,
    nome: orcamento.nome,
    codigo: orcamento.codigo,
    clienteId: orcamento.clienteId,
    tipo: orcamento.tipo,
    descricao: orcamento.descricao,
    observacao: orcamento.observacao,
    validadeEm: orcamento.validadeEm,
    desconto: Number(orcamento.desconto),
    tipoDesconto: orcamento.tipoDesconto,
    proposta: {
      valorMensal: orcamento.valorMensal ? Number(orcamento.valorMensal) : null,
      frequenciaContrato: orcamento.frequenciaContrato,
      diaExecucao: orcamento.diaExecucao,
      dataInicioContrato: orcamento.dataInicioContrato,
      vigenciaMeses: orcamento.vigenciaMeses,
      condicaoPagamento: orcamento.condicaoPagamento,
      diaFaturamento: orcamento.diaFaturamento,
      perfilFaturamento: orcamento.perfilFaturamento,
      exigePcAntesNf: orcamento.exigePcAntesNf,
      responsavelTecnicoId: orcamento.responsavelTecnicoId,
      artNumero: orcamento.artNumero,
      termoReferencia: orcamento.termoReferencia,
      visitasPorPeriodo: orcamento.visitasPorPeriodo,
      equipamentosCobertos: orcamento.equipamentosCobertos,
      prazoEmergencial: orcamento.prazoEmergencial,
      prazoNormal: orcamento.prazoNormal,
      horarioAtendimento: orcamento.horarioAtendimento,
    },
    servicos: orcamento.servicos.map((s) => ({
      id: s.id,
      catalogoId: s.servicoId,
      descricao: s.descricao,
      quantidade: Number(s.quantidade),
      valorUnitario: Number(s.valorUnitario),
      observacao: s.observacao,
    })),
    produtos: orcamento.produtos.map((p) => ({
      id: p.id,
      catalogoId: p.produtoId,
      descricao: p.descricao,
      quantidade: Number(p.quantidade),
      valorUnitario: Number(p.valorUnitario),
      observacao: p.observacao,
    })),
    ordensServicoIds: orcamento.ordensServico.map((o) => o.ordemServicoId),
    osPreCarregadas: orcamento.ordensServico.map((o) => ({
      id: o.ordemServico.id,
      numero: o.ordemServico.numero,
      descricao: o.ordemServico.descricao,
      status: o.ordemServico.status,
    })),
  };

  return (
    <OrcamentoForm
      mode="editar"
      clientes={clientes}
      catalogoServicos={servicos.map((s) => ({ ...s, valorPadrao: s.valorPadrao ? Number(s.valorPadrao) : null }))}
      catalogoProdutos={produtos.map((p) => ({ ...p, valorPadrao: p.valorPadrao ? Number(p.valorPadrao) : null }))}
      tecnicos={tecnicos}
      termoTemplates={termoTemplates}
      inicial={inicial}
    />
  );
}
