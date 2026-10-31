import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroConta } from "@/lib/financeiro/parcelas-server";
import { marcarPerda } from "@/lib/financeiro/perda-estorno-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Marcar como perda (inadimplência): o saldo sai do a receber e fica registrado como perdido. Permissão
 * própria — Financeiro › Perdas (gerente/administrador). Regras: lib/financeiro/perda-estorno.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "perdas");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const corpo = z.object({ motivo: z.string().max(500) }).safeParse(await req.json().catch(() => ({})));
  if (!corpo.success) return NextResponse.json({ erro: "Informe o motivo da perda." }, { status: 400 });
  try {
    const r = await prisma.$transaction((tx) => marcarPerda(tx, {
      empresaId: guard.session.user!.empresaId, contaId: id, motivo: corpo.data.motivo, usuarioId: guard.session.user!.id,
    }), { timeout: 20_000 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
