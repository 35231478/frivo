import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { decidirReajuste, ErroReajuste } from "@/lib/contratos/reajuste-server";

/**
 * PR4 (D8): a decisão do reajuste anual do contrato (da empresa da sessão). Pede "Contratos › Editar".
 * APLICAR manda o valor que a pessoa viu (se o contrato mudou no meio, recusa); ADIAR esconde a sugestão
 * por uns dias; DISPENSAR fecha o aniversário daquele ano sem reajuste.
 */
const corpo = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("APLICAR"), ano: z.number().int().min(2000).max(2200), valorEsperado: z.number().positive() }),
  z.object({ acao: z.literal("ADIAR"), ano: z.number().int().min(2000).max(2200), dias: z.number().int().min(1).max(90).default(30) }),
  z.object({ acao: z.literal("DISPENSAR"), ano: z.number().int().min(2000).max(2200), motivo: z.string().max(300).nullish() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("contratos", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  try {
    const r = await decidirReajuste(guard.session.user!.empresaId, id, parsed.data, guard.session.user!.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErroReajuste) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
