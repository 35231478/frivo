import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pagamentoContaPagarSchema } from "@/lib/validations";
import { exigirPermissao } from "@/lib/permissoes-server";
import { recalcularContaPagar } from "@/lib/financeiro-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;

  const conta = await prisma.contaPagar.findFirst({ where: { id, empresaId: guard.session.user.empresaId } });
  if (!conta) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const pagamentos = await prisma.pagamentoContaPagar.findMany({ where: { contaPagarId: id }, orderBy: { dataPagamento: "desc" } });
  return NextResponse.json(pagamentos);
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const conta = await prisma.contaPagar.findFirst({ where: { id, empresaId } });
  if (!conta) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  if (conta.status === "CANCELADO") return NextResponse.json({ erro: "Conta cancelada" }, { status: 400 });

  const parsed = pagamentoContaPagarSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  await prisma.pagamentoContaPagar.create({
    data: {
      contaPagarId: id,
      valor: d.valor,
      dataPagamento: new Date(d.dataPagamento),
      formaPagamento: d.formaPagamento || null,
      banco: d.banco || null,
      comprovante: d.comprovante || null,
      observacao: d.observacao || null,
    },
  });

  const conta2 = await recalcularContaPagar(id);
  return NextResponse.json(conta2, { status: 201 });
}
