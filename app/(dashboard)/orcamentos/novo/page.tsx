import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrcamentoForm } from "@/components/forms/orcamento-form";

export const metadata: Metadata = { title: "Novo Orçamento" };

export default async function NovoOrcamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ clienteId?: string; osId?: string }>;
}) {
  const { clienteId, osId } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [clientes, servicos, produtos, osInicial] = await Promise.all([
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
    osId
      ? prisma.ordemServico.findFirst({
          where: { id: osId, empresaId },
          select: { id: true, numero: true, descricao: true, status: true, clienteId: true },
        })
      : Promise.resolve(null),
  ]);

  const clienteIdInicial = osInicial?.clienteId ?? clienteId;

  return (
    <OrcamentoForm
      mode="novo"
      clientes={clientes}
      catalogoServicos={servicos.map((s) => ({ ...s, valorPadrao: s.valorPadrao ? Number(s.valorPadrao) : null }))}
      catalogoProdutos={produtos.map((p) => ({ ...p, valorPadrao: p.valorPadrao ? Number(p.valorPadrao) : null }))}
      clienteIdInicial={clienteIdInicial}
      osInicialId={osInicial?.id}
      osInicial={osInicial ? { id: osInicial.id, numero: osInicial.numero, descricao: osInicial.descricao, status: osInicial.status } : undefined}
    />
  );
}
