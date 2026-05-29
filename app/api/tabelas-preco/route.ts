import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tabelaPrecoSchema } from "@/lib/validations";
import { calcularValorFinalTabela } from "@/lib/tabela-preco-helpers";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const tabelas = await prisma.tabelaPreco.findMany({
    where: { empresaId: session.user!.empresaId },
    include: {
      _count: { select: { itens: true, clientes: true } },
    },
    orderBy: [{ tipo: "asc" }, { nome: "asc" }],
  });
  return NextResponse.json(tabelas);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const parsed = tabelaPrecoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Carrega valores padrão dos itens de catálogo para calcular valorFinal
  const servicoIds = data.itens.map((i) => i.servicoId).filter((x): x is string => !!x);
  const produtoIds = data.itens.map((i) => i.produtoId).filter((x): x is string => !!x);
  const [servicos, produtos] = await Promise.all([
    servicoIds.length ? prisma.servico.findMany({ where: { id: { in: servicoIds }, empresaId }, select: { id: true, valorPadrao: true } }) : [],
    produtoIds.length ? prisma.produto.findMany({ where: { id: { in: produtoIds }, empresaId }, select: { id: true, valorPadrao: true } }) : [],
  ]);
  const padraoServico = new Map(servicos.map((s) => [s.id, s.valorPadrao ? Number(s.valorPadrao) : 0]));
  const padraoProduto = new Map(produtos.map((p) => [p.id, p.valorPadrao ? Number(p.valorPadrao) : 0]));

  const tabela = await prisma.tabelaPreco.create({
    data: {
      empresaId,
      nome: data.nome,
      descricao: data.descricao ?? null,
      tipo: data.tipo,
      precosBloqueados: data.precosBloqueados,
      ativo: data.ativo,
      itens: {
        create: data.itens.map((it) => {
          const base = it.servicoId ? padraoServico.get(it.servicoId) : it.produtoId ? padraoProduto.get(it.produtoId) : 0;
          const valorFinal = calcularValorFinalTabela(it.tipoPreco, it.valorFixo, it.descontoPercent, base);
          return {
            servicoId: it.servicoId || null,
            produtoId: it.produtoId || null,
            tipoPreco: it.tipoPreco,
            valorFixo: it.valorFixo ?? null,
            descontoPercent: it.descontoPercent ?? null,
            valorFinal,
            bloqueado: it.bloqueado,
          };
        }),
      },
    },
    include: { itens: true },
  });

  return NextResponse.json(tabela, { status: 201 });
}
