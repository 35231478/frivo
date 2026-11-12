import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { cancelarBoletoInter } from "@/lib/inter-api";
import { registrarEventoCR } from "@/lib/financeiro/conta-receber-server";
import { emitirBoletoDaConta, ErroBoleto } from "@/lib/financeiro/boleto-server";

type Params = { params: Promise<{ id: string }> };

const emitirSchema = z.object({
  vencimento: z.string().optional(),
  mensagem: z.string().optional(),
  descontoValor: z.number().optional(),
  multaPercentual: z.number().optional(),
  jurosPercentualMes: z.number().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const parsed = emitirSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  // Núcleo único (o mesmo da rotina dos contratos): conta trancada, regras de quem pode receber
  // boleto, Inter, evento e o e-mail ao cliente (D6)
  try {
    const { conta } = await emitirBoletoDaConta(empresaId, id, { usuarioId: guard.session.user.id, ...parsed.data });
    return NextResponse.json(conta, { status: 201 });
  } catch (e) {
    if (e instanceof ErroBoleto) return NextResponse.json({ erro: e.message }, { status: e.status });
    return NextResponse.json({ erro: (e as Error)?.message ?? "Erro ao emitir boleto." }, { status: 502 });
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const conta = await prisma.contaReceber.findFirst({ where: { id, empresaId, excluidaEm: null } });
  if (!conta?.boletoId) return NextResponse.json({ erro: "Nenhum boleto para cancelar." }, { status: 400 });
  if (conta.boletoStatus === "PAGO") return NextResponse.json({ erro: "Boleto já pago não pode ser cancelado." }, { status: 400 });

  try {
    await cancelarBoletoInter(empresaId, conta.boletoId);
    await prisma.contaReceber.update({ where: { id }, data: { boletoStatus: "CANCELADO" } });
    await registrarEventoCR({ empresaId, contaReceberId: id, tipo: "BOLETO_CANCELADO", detalhe: "Banco Inter", usuarioId: guard.session.user.id });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "Erro ao cancelar boleto." }, { status: 502 });
  }
}
