import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import {
  inicioDaJanela,
  sugestoesDoHistorico,
  JANELA_MESES,
  type LinhaDoHistorico,
} from "@/lib/orcamentos/sugestoes-itens";

/**
 * Sugestões de item para um cliente (Princípio 9): os serviços e produtos que mais entraram nos
 * orçamentos dele, cada um com o último preço praticado. Quem monta orçamento é quem pede.
 *
 * As regras ficam em lib/orcamentos/sugestoes-itens.ts (a tela e o servidor usam as mesmas): janela
 * de JANELA_MESES meses, mínimo de orçamentos distintos, preço da linha mais recente. Orçamento
 * cancelado não conta — foi um caminho que não vingou.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("orcamentos", "criar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const url = new URL(req.url);
  const clienteId = url.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ erro: "Informe o cliente." }, { status: 400 });
  // O orçamento aberto não se sugere a si mesmo
  const excluirId = url.searchParams.get("excluir");

  const onde = {
    orcamento: {
      empresaId,
      clienteId,
      status: { not: "CANCELADO" as const },
      criadoEm: { gte: inicioDaJanela() },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
  };
  const selecao = {
    orcamentoId: true,
    descricao: true,
    valorUnitario: true,
    orcamento: { select: { criadoEm: true } },
  };

  const [servicos, produtos] = await Promise.all([
    prisma.orcamentoServico.findMany({
      where: onde,
      select: { ...selecao, servicoId: true },
      orderBy: { orcamento: { criadoEm: "desc" } },
      take: 300,
    }),
    prisma.orcamentoProduto.findMany({
      // A peça derivada do material de um serviço não é item escolhido: não se sugere sozinha
      where: { ...onde, materialId: null },
      select: { ...selecao, produtoId: true },
      orderBy: { orcamento: { criadoEm: "desc" } },
      take: 300,
    }),
  ]);

  const linhas: LinhaDoHistorico[] = [
    ...servicos.map((s) => ({
      orcamentoId: s.orcamentoId,
      tipo: "SERVICO" as const,
      catalogoId: s.servicoId,
      descricao: s.descricao,
      valorUnitario: Number(s.valorUnitario),
      criadoEm: s.orcamento.criadoEm,
    })),
    ...produtos.map((p) => ({
      orcamentoId: p.orcamentoId,
      tipo: "PRODUTO" as const,
      catalogoId: p.produtoId,
      descricao: p.descricao,
      valorUnitario: Number(p.valorUnitario),
      criadoEm: p.orcamento.criadoEm,
    })),
  ];

  const sugestoes = sugestoesDoHistorico(linhas);
  // O item do catálogo que foi inativado no meio do caminho não é sugerido (não dá para escolher)
  const idsServico = sugestoes.filter((s) => s.tipo === "SERVICO" && s.catalogoId).map((s) => s.catalogoId!);
  const idsProduto = sugestoes.filter((s) => s.tipo === "PRODUTO" && s.catalogoId).map((s) => s.catalogoId!);
  const [servicosVivos, produtosVivos] = await Promise.all([
    idsServico.length
      ? prisma.servico.findMany({ where: { id: { in: idsServico }, empresaId, ativo: true }, select: { id: true } })
      : [],
    idsProduto.length
      ? prisma.produto.findMany({ where: { id: { in: idsProduto }, empresaId, ativo: true }, select: { id: true } })
      : [],
  ]);
  const vivos = new Set([...servicosVivos, ...produtosVivos].map((x) => x.id));

  return NextResponse.json({
    janelaMeses: JANELA_MESES,
    itens: sugestoes
      .filter((s) => !s.catalogoId || vivos.has(s.catalogoId))
      .map((s) => ({
        tipo: s.tipo,
        catalogoId: s.catalogoId,
        descricao: s.descricao,
        valorUnitario: s.valorUnitario,
        vezes: s.vezes,
      })),
  });
}
