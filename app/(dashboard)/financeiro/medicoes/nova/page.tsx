import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { MedicaoForm } from "@/components/medicao/medicao-form";

export const metadata: Metadata = { title: "Nova medição" };

export default async function NovaMedicaoPage({
  searchParams,
}: {
  searchParams: Promise<{ clienteId?: string }>;
}) {
  const { clienteId } = await searchParams;
  const u = (await auth())!.user!;
  // Criar medição é faturar: Financeiro › medições (a mesma permissão da lista e da rota)
  if (!pode(u.permissoes, "financeiro", "medicoes", u.role)) redirect("/sem-permissao");
  const empresaId = u.empresaId;

  const [clientes, servicos, produtos] = await Promise.all([
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
    prisma.servico.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, codigo: true, nome: true, descricao: true, unidade: true, valorPadrao: true },
      orderBy: { nome: "asc" },
    }),
    prisma.produto.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, codigo: true, nome: true, descricao: true, unidade: true, valorPadrao: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <ProtegerSaida><MedicaoForm
      mode="novo"
      clientes={clientes}
      catalogoServicos={servicos.map((s) => ({ ...s, valorPadrao: s.valorPadrao ? Number(s.valorPadrao) : null }))}
      catalogoProdutos={produtos.map((p) => ({ ...p, valorPadrao: p.valorPadrao ? Number(p.valorPadrao) : null }))}
      clienteIdInicial={clienteId}
    /></ProtegerSaida>
  );
}
