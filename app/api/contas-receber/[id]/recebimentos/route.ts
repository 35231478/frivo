import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { contaBancariaParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { ErroConta, registrarRecebimento } from "@/lib/financeiro/parcelas-server";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** Sem valor = o que falta receber (baixa total) */
  valor: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().optional()),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Informe a data do recebimento"),
  formaPagamento: z.enum(["BOLETO", "PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "CHEQUE"]).optional().nullable(),
  contaBancariaId: z.string().optional().nullable(),
  comentario: z.string().max(500).optional().nullable(),
});

/** Histórico de recebimentos da conta (gaveta de detalhes) */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const lista = await prisma.contaReceberRecebimento.findMany({
    where: { contaReceberId: id, empresaId: guard.session.user!.empresaId },
    orderBy: [{ data: "asc" }, { criadoEm: "asc" }],
    select: { id: true, valor: true, data: true, formaPagamento: true, origem: true, observacao: true, contaBancaria: { select: { nome: true } }, usuario: { select: { nome: true } } },
  });
  return NextResponse.json(lista.map((r) => ({ ...r, valor: Number(r.valor), contaBancaria: r.contaBancaria?.nome ?? null, usuario: r.usuario?.nome ?? null })));
}

/**
 * Informar recebimento — total ou PARCIAL. O saldo que falta continua em aberto (com o vencimento
 * dela); cada baixa fica no histórico. Regras: lib/financeiro/parcelas (+ conta-receber-gestao).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  let contaBancaria: Awaited<ReturnType<typeof contaBancariaParaGravar>>;
  try { contaBancaria = await contaBancariaParaGravar(d.contaBancariaId, empresaId); } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  try {
    const r = await prisma.$transaction((tx) => registrarRecebimento(tx, {
      empresaId, contaId: id, valor: d.valor, data: new Date(d.data.slice(0, 10)),
      formaPagamento: d.formaPagamento ?? null, contaBancariaId: contaBancaria.contaBancariaId ?? null,
      origem: "MANUAL", observacao: d.comentario?.trim() || null, usuarioId: guard.session.user!.id,
    }), { timeout: 20_000 });
    if (r.quitou) {
      const { enviarConfirmacaoPagamento } = await import("@/lib/email");
      await enviarConfirmacaoPagamento(id).catch(() => {});
    }
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
