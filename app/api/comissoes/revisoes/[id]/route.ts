import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { decisaoRevisaoSchema } from "@/lib/comissoes/executor";
import { decidirRevisao } from "@/lib/comissoes/executor-server";

/**
 * COM-2 — decide a revisão do retorno: ESTORNAR (a comissão do técnico vai a zero) ou MANTER, com motivo. Ninguém
 * decide a própria; decidida não muda de novo. "Desempenho › Gerenciar".
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = decisaoRevisaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const u = guard.session.user!;
  const r = await decidirRevisao(u.empresaId, id, parsed.data, { usuarioId: u.id, nome: u.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ ok: true });
}
