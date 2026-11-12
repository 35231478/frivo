import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroConta, parcelarConta, planoSchema } from "@/lib/financeiro/parcelas-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Parcelar a conta: ela vira o lançamento (PARCELADO) e nascem as parcelas, cada uma com vencimento,
 * valor e boleto próprios. As regras (o que pode, soma = total) são as de lib/financeiro/parcelas.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const corpo = z.object({ parcelas: planoSchema }).safeParse(await req.json().catch(() => ({})));
  if (!corpo.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: corpo.error.flatten() }, { status: 400 });
  try {
    const parcelas = await prisma.$transaction((tx) => parcelarConta(tx, {
      empresaId: guard.session.user!.empresaId, contaId: id, parcelas: corpo.data.parcelas, usuarioId: guard.session.user!.id,
    }), { timeout: 20_000 });
    return NextResponse.json({ ok: true, parcelas: parcelas.map((p) => ({ id: p.id, numero: p.numero, valor: Number(p.valor), dataVencimento: p.dataVencimento })) }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
