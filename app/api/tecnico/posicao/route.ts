import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { tecnicoDaSessao } from "@/lib/tecnico/sessao";
import { envioPosicoesSchema } from "@/lib/tecnico/posicao";
import { registrarPosicoes } from "@/lib/tecnico/posicao-server";

/**
 * O app do técnico envia a localização do aparelho (Operações › Mapa). É o ÚNICO ponto de entrada —
 * o app web manda em momentos-chave, com o app aberto; o app nativo, quando existir, manda para cá
 * também (mais leituras, mesmo formato).
 *
 * Só grava com "Rastrear localização dos técnicos" ligado na empresa. A posição é sempre a do
 * técnico ligado ao usuário logado: ninguém envia a posição de outra pessoa. A resposta diz se o
 * rastreamento está ligado, para o app parar de capturar quando a empresa desliga.
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const parsed = envioPosicoesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Posição inválida" }, { status: 400 });
  const { user } = guard.session;
  const tecnico = await tecnicoDaSessao(guard.session);
  // Usuário sem técnico ligado não aparece no mapa: nada a gravar (e nada a tentar de novo)
  if (!tecnico) return NextResponse.json({ rastreio: false, gravada: false }, { headers: { "Cache-Control": "private, no-store" } });
  const resultado = await registrarPosicoes({ empresaId: user.empresaId, tecnicoId: tecnico.id, usuarioId: user.id ?? null }, parsed.data);
  return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
}
