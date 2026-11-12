import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { renovacaoSchema } from "@/lib/pmoc-renovacao";
import { previaDaRenovacao, renovarPmoc } from "@/lib/pmoc-renovacao-server";

type Params = { params: Promise<{ id: string }> };

/** O que o diálogo "Renovar" mostra: a vigência proposta, o que vai e o que fica. Exige "PMOC › Editar". */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const previa = await previaDaRenovacao(id, guard.session.user!.empresaId);
  if (!previa) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json(previa);
}

/**
 * Renova o plano: cria um plano NOVO, em rascunho, para a vigência informada, com os equipamentos
 * ativos e o cronograma deslocado. Não leva ART, link público, histórico, avisos, ocorrências nem as OS geradas.
 * Exige "PMOC › Editar".
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const parsed = renovacaoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await renovarPmoc(id, { empresaId: session.user!.empresaId, usuarioId: session.user!.id }, parsed.data);
  if (!r) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json({
    id: r.id, equipamentos: r.plano.equipamentoIds.length, itens: r.plano.itens.length,
    equipamentosFora: r.plano.equipamentosFora.length, itensFora: r.plano.itensFora.length,
  }, { status: 201 });
}
