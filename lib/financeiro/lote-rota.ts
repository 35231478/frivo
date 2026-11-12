import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Acao } from "@/lib/permissoes";
import { exigirPermissao } from "@/lib/permissoes-server";
import { contaBancariaParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { ACOES_LOTE, MAX_DIAS, MAX_LOTE, motivoPedidoInvalido, type TipoLista } from "@/lib/financeiro/acoes-lote";
import { executarLotePagar, executarLoteReceber, type PedidoLote, type ResultadoLote } from "@/lib/financeiro/lote-server";

/**
 * Rota das ações em lote (POST /api/contas-receber/lote e /api/contas-pagar/lote): a MESMA permissão
 * da ação individual de cada lista, o pedido validado uma vez (nada toca o banco se o formulário
 * estiver errado) e a execução numa transação só. Devolve o que foi feito e o que foi ignorado com o
 * motivo; se a transação cair, nada foi feito e a resposta diz isso.
 */
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const schema = z.object({
  acao: z.enum(ACOES_LOTE),
  ids: z.array(z.string().min(1).max(40)).min(1, "Nenhuma conta selecionada").max(MAX_LOTE, `No máximo ${MAX_LOTE} contas por vez.`),
  data: dia.optional().nullable(),
  formaPagamento: z.enum(["BOLETO", "PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "CHEQUE"]).optional().nullable(),
  contaBancariaId: z.string().max(40).optional().nullable(),
  banco: z.string().max(120).optional().nullable(),
  vencimento: z.discriminatedUnion("modo", [
    z.object({ modo: z.literal("data"), data: dia }),
    z.object({ modo: z.literal("dias"), dias: z.number().int().min(-MAX_DIAS).max(MAX_DIAS) }),
  ]).optional().nullable(),
  motivo: z.string().trim().max(500).optional().nullable(),
}).strict();

const PERMISSAO: Record<TipoLista, Acao> = { receber: "contasReceber", pagar: "fluxoCaixa" };

export async function rotaLote(req: NextRequest, tipo: TipoLista) {
  const guard = await exigirPermissao("financeiro", PERMISSAO[tipo]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const usuarioId = guard.session.user!.id;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Requisição inválida", detalhes: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const invalido = motivoPedidoInvalido(d.acao, d);
  if (invalido) return NextResponse.json({ erro: invalido }, { status: 400 });

  // Conta bancária (receber): precisa ser da empresa e ativa
  let contaBancariaId: string | null = null;
  if (tipo === "receber" && d.acao === "baixar" && d.contaBancariaId) {
    try { contaBancariaId = (await contaBancariaParaGravar(d.contaBancariaId, empresaId)).contaBancariaId ?? null; } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  }

  const pedido: PedidoLote = {
    empresaId, usuarioId, acao: d.acao, ids: d.ids, data: d.data ?? null, formaPagamento: d.formaPagamento ?? null,
    contaBancariaId, banco: d.banco ?? null, vencimento: d.vencimento ?? null, motivo: d.motivo ?? null,
  };
  let r: ResultadoLote;
  try {
    r = await (tipo === "receber" ? executarLoteReceber(pedido) : executarLotePagar(pedido));
  } catch (e) {
    console.error("[lote]", tipo, d.acao, e);
    return NextResponse.json({ erro: "Não foi possível concluir: nada foi alterado. Tente de novo." }, { status: 500 });
  }
  console.info(JSON.stringify({ evento: "acao_em_lote", quando: new Date().toISOString(), lista: tipo, acao: d.acao, usuarioId, empresaId, pedidas: d.ids.length, feitas: r.feitas.length, ignoradas: r.ignoradas.length }));

  // Confirmação por e-mail das cobranças quitadas (depois do commit; falha não derruba a resposta)
  if (tipo === "receber" && r.quitadas.length) {
    const { enviarConfirmacaoPagamento } = await import("@/lib/email");
    for (const id of r.quitadas) await enviarConfirmacaoPagamento(id).catch(() => {});
  }
  return NextResponse.json({ ok: true, feitas: r.feitas, ignoradas: r.ignoradas, total: r.total, resumo: { pedidas: d.ids.length, feitas: r.feitas.length, ignoradas: r.ignoradas.length } });
}
