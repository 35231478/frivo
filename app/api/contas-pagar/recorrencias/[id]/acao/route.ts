import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import {
  ErroRecorrencia, encerrarRecorrencia, gerarContasDaRecorrencia, pausarRecorrencia, retomarRecorrencia,
} from "@/lib/financeiro/conta-pagar-recorrencia-server";

/**
 * O que se faz com a REGRA sem mexer nas contas já geradas, uma a uma:
 *  - PAUSAR: para de gerar e tira do caminho as ocorrências futuras ainda em aberto;
 *  - RETOMAR: volta a valer e regera do mês corrente em diante;
 *  - ENCERRAR: para de vez (o mesmo que "excluir": o histórico fica);
 *  - GERAR: empurra o horizonte desta regra (o cron faz isso todo dia, para todas).
 * Tudo exige "Financeiro › Fluxo de caixa".
 */
const schema = z.object({
  acao: z.enum(["PAUSAR", "RETOMAR", "ENCERRAR", "GERAR"]),
  motivo: z.string().max(500).optional().nullable(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });

  try {
    switch (parsed.data.acao) {
      case "PAUSAR": return NextResponse.json({ ok: true, ...(await pausarRecorrencia(empresaId, id)) });
      case "RETOMAR": return NextResponse.json({ ok: true, ...(await retomarRecorrencia(empresaId, id)) });
      case "ENCERRAR": return NextResponse.json({ ok: true, ...(await encerrarRecorrencia(empresaId, id, parsed.data.motivo)) });
      case "GERAR": return NextResponse.json({ ok: true, contas: await gerarContasDaRecorrencia(id, { empresaId }) });
    }
  } catch (e) {
    if (e instanceof ErroRecorrencia) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
