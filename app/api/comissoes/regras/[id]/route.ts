import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { normalizarRegra, regraSchema } from "@/lib/comissoes/regras";
import { salvarRegra } from "@/lib/comissoes/servidor";

/**
 * COM-1 — edita uma regra (inclusive desativar: `ativo: false`). Nada se apaga: a comissão que já nasceu guarda a
 * regra como era, e mudar a regra não mexe no passado. "Desempenho › Gerenciar".
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = regraSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await salvarRegra(guard.session.user!.empresaId, normalizarRegra(parsed.data), { id });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ id: r.id });
}
