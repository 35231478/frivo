import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tabelaPrecoSchema } from "@/lib/validations";
import { calcularValorFinalTabela } from "@/lib/tabela-preco-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const tabela = await prisma.tabelaPreco.findFirst({
    where: { id, empresaId },
    include: {
      itens: {
        include: {
          servico: { select: { id: true, nome: true, valorPadrao: true } },
          produto: { select: { id: true, nome: true, valorPadrao: true } },
        },
      },
    },
  });
  if (!tabela) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(tabela);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.tabelaPreco.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  if (typeof body.ativo === "boolean" && Object.keys(body).length === 1) {
    const upd = await prisma.tabelaPreco.update({ where: { id }, data: { ativo: body.ativo } });
    return NextResponse.json(upd);
  }

  const parsed = tabelaPrecoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const servicoIds = data.itens.map((i) => i.servicoId).filter((x): x is string => !!x);
  const produtoIds = data.itens.map((i) => i.produtoId).filter((x): x is string => !!x);
  const [servicos, produtos] = await Promise.all([
    servicoIds.length ? prisma.servico.findMany({ where: { id: { in: servicoIds }, empresaId }, select: { id: true, valorPadrao: true } }) : [],
    produtoIds.length ? prisma.produto.findMany({ where: { id: { in: produtoIds }, empresaId }, select: { id: true, valorPadrao: true } }) : [],
  ]);
  const padraoServico = new Map(servicos.map((s) => [s.id, s.valorPadrao ? Number(s.valorPadrao) : 0]));
  const padraoProduto = new Map(produtos.map((p) => [p.id, p.valorPadrao ? Number(p.valorPadrao) : 0]));

  const atualizada = await prisma.tabelaPreco.update({
    where: { id },
    data: {
      nome: data.nome,
      descricao: data.descricao ?? null,
      tipo: data.tipo,
      precosBloqueados: data.precosBloqueados,
      ativo: data.ativo,
      itens: {
        deleteMany: {},
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

  return NextResponse.json(atualizada);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.tabelaPreco.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await prisma.tabelaPreco.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
