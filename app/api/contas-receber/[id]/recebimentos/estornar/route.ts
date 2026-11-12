import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroConta } from "@/lib/financeiro/parcelas-server";
import { estornarRecebimento } from "@/lib/financeiro/perda-estorno-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Estornar recebimento (baixa errada): um recebimento escolhido, ou a baixa antiga (sem recebimentoId).
 * O saldo volta a ficar em aberto; o estorno fica no histórico com motivo e autor. Contas a Receber.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const corpo = z.object({ recebimentoId: z.string().optional().nullable(), motivo: z.string().max(500) }).safeParse(await req.json().catch(() => ({})));
  if (!corpo.success) return NextResponse.json({ erro: "Informe o motivo do estorno." }, { status: 400 });
  try {
    const r = await prisma.$transaction((tx) => estornarRecebimento(tx, {
      empresaId: guard.session.user!.empresaId, contaId: id, recebimentoId: corpo.data.recebimentoId ?? null,
      motivo: corpo.data.motivo, usuarioId: guard.session.user!.id,
    }), { timeout: 20_000 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
