import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { aprovacaoEquipeSchema } from "@/lib/orcamentos/aprovacao-equipe";
import { registrarAprovacaoDaEquipe } from "@/lib/orcamentos/aprovacao-equipe-server";
import { escopoBarra } from "@/lib/escopo/proprios-server";

/**
 * "Cliente aprovou" pela equipe (por telefone, WhatsApp...): quem aprovou, o canal e a observação.
 * Permissão: Orçamentos › Aprovar. Empresa da sessão. Regras: lib/orcamentos/aprovacao-equipe.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "aprovar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("orcamento", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const parsed = aprovacaoEquipeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  const u = guard.session.user!;
  const r = await registrarAprovacaoDaEquipe(u.empresaId, id, parsed.data, { id: u.id, nome: u.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ ok: true, status: "APROVADO" });
}
