import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { etapaCiclo, ipDaRequisicao } from "@/lib/orcamentos/ciclo";
import { registrarVisualizacao } from "@/lib/orcamentos/ciclo-server";

/**
 * O orçamento pelo link público (JSON). Só o que o cliente vê no documento: nada de observações
 * internas, CPF de quem assinou, IPs, navegador ou dados de quem criou. Abrir conta como
 * visualização (a não ser que seja alguém da própria empresa logado).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const orcamento = await prisma.orcamento.findUnique({
    where: { tokenPublico: token },
    select: {
      id: true, empresaId: true, codigo: true, nome: true, status: true, tipo: true, descricao: true, validadeEm: true, criadoEm: true,
      enviadoEm: true, visualizadoEm: true, assinadoEm: true, assinadoPor: true, recusadoEm: true,
      prazoExecucao: true, formaPagamento: true, garantiaServico: true, garantiaPecas: true, naoIncluso: true, normas: true,
      totalServicos: true, totalProdutos: true, totalGeral: true, descontoServicos: true, tipoDescontoServicos: true,
      descontoProdutos: true, tipoDescontoProdutos: true, issAliquota: true,
      empresa: {
        select: {
          nome: true, nomeFantasia: true, cnpj: true, email: true, telefone: true, celular: true,
          site: true, logo: true, endereco: true, numero: true, complemento: true, bairro: true,
          cidade: true, estado: true, cep: true,
        },
      },
      cliente: {
        select: {
          nome: true, nomeFantasia: true, cpfCnpj: true, email: true, telefone: true,
          endereco: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true,
        },
      },
      servicos: { orderBy: { ordem: "asc" }, select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, observacao: true } },
      produtos: { orderBy: { ordem: "asc" }, select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, observacao: true } },
    },
  });

  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orcamento.status === "CANCELADO") {
    return NextResponse.json({ erro: "Orçamento cancelado" }, { status: 410 });
  }

  const sessao = await auth().catch(() => null);
  await registrarVisualizacao(orcamento, { empresaIdSessao: sessao?.user?.empresaId ?? null, ip: ipDaRequisicao(req.headers), userAgent: req.headers.get("user-agent") });

  const { id: _id, empresaId: _e, ...publico } = orcamento;
  return NextResponse.json({ ...publico, etapa: etapaCiclo(orcamento) });
}
