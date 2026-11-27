import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDaSessao } from "@/lib/execucao/contexto";
import { despesasDoColaborador } from "@/lib/execucao/despesas";
import { MSG_SEM_COLABORADOR } from "@/lib/tecnico/despesas";

/** "Minhas despesas" (app do técnico): só as do colaborador da sessão, sem foto (a foto vem por rota própria). */
export async function GET() {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const lista = await despesasDoColaborador(atorDaSessao(guard.session));
  if (!lista) return NextResponse.json({ despesas: [], aviso: MSG_SEM_COLABORADOR });
  return NextResponse.json({ despesas: lista }, { headers: { "Cache-Control": "private, no-store" } });
}
