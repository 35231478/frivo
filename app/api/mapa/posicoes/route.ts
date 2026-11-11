import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { posicoesDoMapa } from "@/lib/tecnico/posicao-server";

/**
 * Operações › Mapa: a última posição conhecida de cada técnico de campo da empresa. Só a gestão
 * (Equipes › Gerenciar) — o técnico não tem esta permissão e fica confinado ao /tecnico.
 * Com "Rastrear localização dos técnicos" desligado, nenhuma posição sai daqui.
 */
export async function GET() {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await posicoesDoMapa(guard.session.user.empresaId), { headers: { "Cache-Control": "private, no-store" } });
}
