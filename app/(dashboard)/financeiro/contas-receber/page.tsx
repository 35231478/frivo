import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ContasReceberView, type ContaView } from "@/components/financeiro/contas-receber-view";

export const metadata: Metadata = { title: "Contas a Receber" };

export default async function ContasReceberPage({
  searchParams,
}: {
  searchParams: Promise<{ clienteId?: string }>;
}) {
  const { clienteId = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  await prisma.contaReceber.updateMany({
    where: { empresaId, status: { in: ["PREVISTO", "A_RECEBER"] }, dataVencimento: { lt: hoje } },
    data: { status: "ATRASADO" },
  });

  const [contas, clientes, categorias, integracao] = await Promise.all([
    prisma.contaReceber.findMany({
      where: { empresaId },
      include: {
        cliente: {
          select: {
            id: true, nome: true, nomeFantasia: true, logo: true, cpfCnpj: true,
            email: true, telefone: true, celular: true, whatsappFaturamento: true, emailsFaturamento: true,
          },
        },
      },
      orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }],
      take: 500,
    }),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true }, orderBy: { nome: "asc" } }),
    prisma.categoriaFinanceira.findMany({ where: { empresaId, ativo: true }, select: { nome: true, cor: true }, orderBy: { nome: "asc" } }),
    prisma.integracaoInter.findUnique({ where: { empresaId }, select: { ativo: true } }),
  ]);

  const view: ContaView[] = contas.map((c) => ({
    id: c.id, numero: c.numero, descricao: c.descricao, categoria: c.categoria, valor: Number(c.valor),
    dataVencimento: c.dataVencimento ? c.dataVencimento.toISOString() : null,
    dataRecebimento: c.dataRecebimento ? c.dataRecebimento.toISOString() : null,
    status: c.status, banco: c.banco, formaPagamento: c.formaPagamento,
    clienteId: c.cliente.id,
    clienteNome: c.cliente.nomeFantasia ?? c.cliente.nome,
    clienteCnpj: c.clienteCnpj ?? c.cliente.cpfCnpj,
    clienteLogo: c.cliente.logo,
    whatsapp: c.cliente.whatsappFaturamento ?? c.cliente.celular ?? c.cliente.telefone ?? null,
    email: c.cliente.emailsFaturamento?.[0] ?? c.cliente.email ?? null,
    notificacaoEnviadaEm: c.notificacaoEnviadaEm ? c.notificacaoEnviadaEm.toISOString() : null,
    boletoStatus: c.boletoStatus,
    boletoEmitidoEm: c.boletoEmitidoEm ? c.boletoEmitidoEm.toISOString() : null,
    boletoVencimento: c.boletoVencimento ? c.boletoVencimento.toISOString() : null,
    boletoLinhaDigitavel: c.boletoLinhaDigitavel,
    boletoCodigoBarras: c.boletoCodigoBarras,
  }));

  return (
    <ContasReceberView
      contas={view}
      clientes={clientes.map((c) => ({ id: c.id, nome: c.nomeFantasia ?? c.nome }))}
      categorias={categorias}
      interAtivo={!!integracao?.ativo}
      clienteIdInicial={clienteId}
    />
  );
}
