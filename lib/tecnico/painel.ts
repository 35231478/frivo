import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { emModoTecnico } from "@/lib/tecnico/modo";

export const MSG_PAINEL_BLOQUEADO = "Esta área é do painel e não fica disponível no app do técnico.";

/**
 * Trava de servidor: nega as rotas/APIs do PAINEL para quem está no modo técnico (app de campo).
 * As demais áreas do painel (financeiro, clientes, estoque, orçamentos, configurações) já caem no
 * 403 do RBAC porque não estão no perfil do técnico; isto cobre o que o perfil de técnico PODE ver no
 * painel mas não deve pelo app — as OS de toda a empresa (lista/detalhe de Ordens). As rotas do app
 * (/api/tecnico/*, execução de atividade, anexos da OS) não usam esta trava e seguem com o escopo do
 * técnico. Retorna um 403 pronto quando deve bloquear, ou null para seguir.
 */
export function bloqueioPainelTecnico(session: Session | null | undefined): NextResponse | null {
  if (session && emModoTecnico(session.user)) {
    return NextResponse.json({ erro: MSG_PAINEL_BLOQUEADO }, { status: 403 });
  }
  return null;
}
