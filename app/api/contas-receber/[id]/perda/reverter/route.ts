import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { contaBancariaParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { ErroConta } from "@/lib/financeiro/parcelas-server";
import { reverterPerda } from "@/lib/financeiro/perda-estorno-server";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  modo: z.enum(["REABRIR", "RECUPERAR"]),
  motivo: z.string().max(500).optional().nullable(),
  /** RECUPERAR: o que o cliente pagou (sem valor = o saldo inteiro) */
  valor: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().optional()),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional().nullable(),
  formaPagamento: z.enum(["BOLETO", "PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "CHEQUE"]).optional().nullable(),
  contaBancariaId: z.string().optional().nullable(),
});

/**
 * Reverter perda: a cobrança volta a receber; ou o cliente pagou depois (RECUPERAR) — volta e já registra
 * o recebimento (origem "Recuperação de perda"). Permissão: Financeiro › Perdas.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "perdas");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  let contaBancaria: Awaited<ReturnType<typeof contaBancariaParaGravar>>;
  try { contaBancaria = await contaBancariaParaGravar(d.contaBancariaId, empresaId); } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  try {
    const r = await prisma.$transaction((tx) => reverterPerda(tx, {
      empresaId, contaId: id, usuarioId: guard.session.user!.id, modo: d.modo, motivo: d.motivo,
      recebimento: d.modo === "RECUPERAR" && d.data
        ? { valor: d.valor, data: new Date(d.data.slice(0, 10)), formaPagamento: d.formaPagamento ?? null, contaBancariaId: contaBancaria.contaBancariaId ?? null }
        : null,
    }), { timeout: 20_000 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
