import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { tetoSchema } from "@/lib/comissoes/executor";
import { salvarTeto } from "@/lib/comissoes/executor-server";

/**
 * COM-2 — cria um TETO mensal de comissão (por pessoa ou por cargo; a pessoa vence o cargo). O que passar do teto no
 * fechamento vai para o mês seguinte. "Desempenho › Gerenciar".
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = tetoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await salvarTeto(guard.session.user!.empresaId, parsed.data);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ id: r.id }, { status: 201 });
}
