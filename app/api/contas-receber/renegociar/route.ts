import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { contaBancariaParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { ErroConta, planoSchema } from "@/lib/financeiro/parcelas-server";
import { MAX_RENEGOCIAR, renegociar, renegociaveisDoCliente } from "@/lib/financeiro/renegociacao-server";

const num = z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number());
const schema = z.object({
  contaIds: z.array(z.string()).min(1, "Escolha pelo menos uma cobrança.").max(MAX_RENEGOCIAR),
  juros: num.optional(), multa: num.optional(), desconto: num.optional(),
  parcelas: planoSchema.min(1, "Informe o vencimento."),
  formaPagamento: z.enum(["BOLETO", "PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "CHEQUE"]).optional().nullable(),
  contaBancariaId: z.string().optional().nullable(),
  observacao: z.string().max(500).optional().nullable(),
});

/** As cobranças do cliente para escolher na renegociação (as que não podem vêm com o porquê). Contas a Receber. */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const clienteId = req.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ erro: "Informe o cliente." }, { status: 400 });
  return NextResponse.json(await renegociaveisDoCliente(guard.session.user!.empresaId, clienteId));
}

/**
 * Renegociar: 1+ cobranças em aberto do mesmo cliente viram uma conta nova (saldo + juros + multa −
 * desconto), à vista ou parcelada. Permissão: Financeiro › Perdas (o mesmo nível de decisão da perda).
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "perdas");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  let contaBancaria: Awaited<ReturnType<typeof contaBancariaParaGravar>> | null = null;
  if (d.contaBancariaId !== undefined) {
    try { contaBancaria = await contaBancariaParaGravar(d.contaBancariaId, empresaId); } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  }
  try {
    const r = await prisma.$transaction((tx) => renegociar(tx, {
      empresaId, contaIds: d.contaIds, juros: d.juros, multa: d.multa, desconto: d.desconto, plano: d.parcelas,
      formaPagamento: d.formaPagamento ?? null, observacao: d.observacao ?? null, usuarioId: guard.session.user!.id,
      ...(contaBancaria && { contaBancariaId: contaBancaria.contaBancariaId ?? null }),
    }), { timeout: 30_000 });
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
