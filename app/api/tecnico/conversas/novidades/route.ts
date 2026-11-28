import { NextRequest, NextResponse } from "next/server";
import { esperarNovidades, marcaAtual, ondeNovidadesTecnico } from "@/lib/chat/servidor";
import { naoLidasDoTecnico } from "@/lib/chat/pessoas-servidor";
import { guardaTecnico, lerDesde, SEM_CACHE } from "@/lib/chat/rotas-server";
import { registrarContato } from "@/lib/chat/presenca-servidor";

/** O long-polling segura a resposta por até 8 s (ESPERA_NOVIDADES_MS): folga para o limite da função na Vercel. */
export const maxDuration = 20;

/** GET /api/tecnico/conversas/novidades?desde=<marca> — CHAT-1, o tempo real do app: só as OS do técnico. */
export async function GET(req: NextRequest) {
  const g = await guardaTecnico();
  if (g.resposta) return g.resposta;
  // CHAT-1.2: o app está aberto e com sinal (o escritório vê a presença)
  await registrarContato(g.usuarioId);
  const onde = await ondeNovidadesTecnico(g.empresaId, g.tecnicoId, g.usuarioId);
  const desde = lerDesde(req.url);
  const r = await esperarNovidades(() => marcaAtual(onde, g.usuarioId), desde, { cancelado: () => req.signal.aborted });
  // O contador do Chat na barra do app (o que o escritório mandou e ele não leu), só quando algo mudou
  const naoLidas = r.mudou || !desde ? await naoLidasDoTecnico(g.empresaId, g.usuarioId, g.tecnicoId) : undefined;
  return NextResponse.json({ ...r, ...(naoLidas !== undefined && { naoLidas }) }, { headers: SEM_CACHE });
}
