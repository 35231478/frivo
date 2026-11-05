import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { proximoNumeroSchema } from "@/lib/numeracao";
import { definirProximo, lerNumeracoes } from "@/lib/numeracao-server";

/**
 * Configurações › Numeração de documentos — da empresa da sessão.
 * GET: Configurações › visualizar (cada tipo com o maior já usado, o próximo e o exemplo).
 * PUT: Configurações › gerenciar; { tipo, proximo }. Recusa (409) um próximo igual ou abaixo do maior
 * já usado, dizendo o mínimo: nunca nasce documento com número repetido. Só os próximos mudam.
 */
export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json({ numeracoes: await lerNumeracoes(guard.session.user!.empresaId) });
}

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = proximoNumeroSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const r = await definirProximo(guard.session.user!.empresaId, parsed.data.tipo, parsed.data.proximo);
  if (!r.ok) return NextResponse.json({ erro: r.erro, minimo: r.minimo }, { status: 409 });
  return NextResponse.json({ tipo: parsed.data.tipo, proximo: r.proximo, exemplo: r.exemplo });
}
