import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MedicaoForm } from "@/components/medicao/medicao-form";

export const metadata: Metadata = { title: "Editar Medição" };

export default async function EditarMedicaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [medicao, clientes, servicos, produtos] = await Promise.all([
    prisma.medicao.findFirst({
      where: { id, empresaId },
      include: { itens: { orderBy: { ordem: "asc" } } },
    }),
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
  ]);

  if (!medicao) notFound();
  if (medicao.status !== "RASCUNHO") redirect(`/financeiro/medicoes/${id}`);

  const servicosItens = medicao.itens
    .filter((it) => it.tipo === "SERVICO")
    .map((it) => ({ id: it.id, catalogoId: it.servicoId, descricao: it.descricao, quantidade: Number(it.quantidade), valorUnitario: Number(it.valorUnitario), observacao: it.observacao }));
  const produtosItens = medicao.itens
    .filter((it) => it.tipo === "PRODUTO")
    .map((it) => ({ id: it.id, catalogoId: it.produtoId, descricao: it.descricao, quantidade: Number(it.quantidade), valorUnitario: Number(it.valorUnitario), observacao: it.observacao }));

  return (
    <MedicaoForm
      mode="editar"
      clientes={clientes}
      catalogoServicos={servicos.map((s) => ({ ...s, valorPadrao: s.valorPadrao ? Number(s.valorPadrao) : null }))}
      catalogoProdutos={produtos.map((p) => ({ ...p, valorPadrao: p.valorPadrao ? Number(p.valorPadrao) : null }))}
      inicial={{
        id: medicao.id,
        numero: medicao.numero,
        clienteId: medicao.clienteId,
        contratoId: medicao.contratoId,
        tipo: medicao.tipo,
        mes: medicao.mes,
        ano: medicao.ano,
        descricao: medicao.descricao,
        observacao: medicao.observacao,
        descontoValor: Number(medicao.descontoValor),
        descontoPercent: Number(medicao.descontoPercent),
        servicos: servicosItens,
        produtos: produtosItens,
      }}
    />
  );
}
