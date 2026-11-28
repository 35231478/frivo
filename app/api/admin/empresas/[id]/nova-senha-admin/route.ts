import { NextRequest, NextResponse } from "next/server";
import { exigirDonoDoFrivo } from "@/lib/empresa/guarda-dono";
import { gerarNovaSenhaDoAdmin } from "@/lib/empresa/criar-empresa";

/**
 * POST — nova senha provisória do 1º administrador da empresa (o ADMIN ativo mais antigo). Só o dono do Frivo
 * (SUPER_ADMIN; os outros recebem 403). A senha vai só nesta resposta, uma vez; no banco fica o hash, com a troca
 * obrigatória no próximo acesso, e as sessões abertas desse usuário caem. A trilha registra de quem foi, sem a senha.
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigirDonoDoFrivo();
  if (g.erro) return g.erro;
  const r = await gerarNovaSenhaDoAdmin({ empresaId: (await params).id, autorId: g.session.user.id });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  // Nunca em cache: a senha só existe nesta resposta
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
