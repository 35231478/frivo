import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { meuDia } from "@/lib/tecnico/dia";
import { MSG_SEM_TECNICO, tecnicoDaSessao } from "@/lib/tecnico/sessao";

/** "Meu dia": as atividades de hoje atribuídas ao técnico do usuário (+ as começadas e não concluídas). */
export async function GET() {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const tecnico = await tecnicoDaSessao(guard.session);
  if (!tecnico) return NextResponse.json({ tecnico: null, aviso: MSG_SEM_TECNICO, dia: null, atividades: [], anteriores: [] });
  const dia = await meuDia(guard.session.user.empresaId, tecnico.id);
  return NextResponse.json({ tecnico, ...dia }, { headers: { "Cache-Control": "private, no-store" } });
}
