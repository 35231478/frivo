import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { validarRegra } from "@/lib/financeiro/conta-pagar-recorrencia";
import { ErroRecorrencia, tornarContaRecorrente } from "@/lib/financeiro/conta-pagar-recorrencia-server";
import { recorrenciaUpdateSchema } from "@/lib/validations";

/**
 * TORNAR RECORRENTE uma conta a pagar que já existe: a conta NÃO é recriada — continua com o
 * número, os pagamentos e o histórico dela e passa a ser a primeira ocorrência da regra; as
 * próximas nascem a partir dela. Exige "Financeiro › Fluxo de caixa".
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const parsed = recorrenciaUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  // A conta dá a descrição, o favorecido e o valor que faltarem; a regra precisa estar completa
  const conta = await prisma.contaPagar.findFirst({ where: { id, empresaId } });
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  const base = conta.dataVencimento ?? new Date();
  const completa = {
    ...d,
    descricao: d.descricao ?? conta.descricao,
    valor: d.valor ?? Number(conta.valorTotal),
    inicioAno: d.inicioAno ?? base.getFullYear(),
    inicioMes: d.inicioMes ?? base.getMonth() + 1,
    diaVencimento: d.diaVencimento ?? base.getDate(),
    passoMeses: d.passoMeses ?? 1,
  };
  const erro = validarRegra(completa);
  if (erro) return NextResponse.json({ erro }, { status: 400 });

  try {
    const { regra } = await tornarContaRecorrente(empresaId, id, completa, guard.session.user.id);
    return NextResponse.json({ ok: true, regra }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroRecorrencia) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
