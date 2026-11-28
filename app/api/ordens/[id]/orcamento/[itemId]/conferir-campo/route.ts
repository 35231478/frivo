import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { escopoBarra } from "@/lib/escopo/proprios-server";
import { conferirItemCampo } from "@/lib/os/material-campo-cobranca-server";

type Params = { params: Promise<{ id: string; itemId: string }> };

/**
 * Leva I.2 — POST: o escritório confere o material lançado em campo que virou item cobrado ("Cobrado à parte").
 *  - { acao: "confirmar", quantidade?, valorUnitario? }: o item fica como está (ou ajustado) e libera o faturamento;
 *  - { acao: "remover" }: sai da cobrança (o uso em campo e o estoque ficam como estão).
 * Quem pode: quem edita a OS.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, itemId } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const corpo = await req.json().catch(() => null);
  const r = await conferirItemCampo({ empresaId: session.user!.empresaId, osId: id, itemId, usuarioId: session.user!.id }, corpo && typeof corpo === "object" ? corpo : {});
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ ok: true, item: r.item });
}
