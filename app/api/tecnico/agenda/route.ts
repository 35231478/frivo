import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { agenda } from "@/lib/tecnico/dia";
import { MSG_SEM_TECNICO, tecnicoDaSessao } from "@/lib/tecnico/sessao";

/** Agenda do técnico: hoje e os próximos dias (padrão 14, no máximo 31), agrupados por dia. */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const tecnico = await tecnicoDaSessao(guard.session);
  if (!tecnico) return NextResponse.json({ tecnico: null, aviso: MSG_SEM_TECNICO, dias: [] });
  const n = Math.min(31, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 14));
  return NextResponse.json({ tecnico, dias: await agenda(guard.session.user.empresaId, tecnico.id, n) }, { headers: { "Cache-Control": "private, no-store" } });
}
