import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { aprovacaoSchema } from "@/lib/tecnico/despesas";
import { aprovarDespesa } from "@/lib/execucao/despesas";

type Params = { params: Promise<{ id: string }> };

/**
 * POST { vencimento?, categoriaId? } — aprova. Paga do próprio bolso: gera a conta a pagar de reembolso ao
 * colaborador (vencimento obrigatório). Paga pela empresa: só registra. Quem lança contas a pagar (Financeiro › Fluxo de caixa).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const parsed = aprovacaoSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { id } = await params;
  const r = await aprovarDespesa(guard.session.user.empresaId, id, guard.session.user.id, parsed.data);
  return r.ok ? NextResponse.json(r.dados) : NextResponse.json({ erro: r.erro }, { status: r.status });
}
