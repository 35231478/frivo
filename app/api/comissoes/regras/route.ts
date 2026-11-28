import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { normalizarRegra, regraSchema } from "@/lib/comissoes/regras";
import { salvarRegra } from "@/lib/comissoes/servidor";

/** COM-1 — cria uma regra de comissão ("Desempenho › Gerenciar"). */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = regraSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const u = guard.session.user!;
  const r = await salvarRegra(u.empresaId, normalizarRegra(parsed.data), { criadoPorId: u.id });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ id: r.id }, { status: 201 });
}
