import { NextRequest, NextResponse } from "next/server";
import { conversasNaoLidasDoEscritorio, esperarNovidades, marcaAtual, ondeNovidadesEscritorio } from "@/lib/chat/servidor";
import { pessoasNaoLidas, podeConversas } from "@/lib/chat/pessoas-servidor";
import { guardaEscritorio, lerDesde, SEM_CACHE } from "@/lib/chat/rotas-server";

/** O long-polling segura a resposta por até 8 s (ESPERA_NOVIDADES_MS): folga para o limite da função na Vercel. */
export const maxDuration = 20;

/**
 * GET /api/conversas/novidades?desde=<marca> — CHAT-1, o tempo real do escritório (long-polling curto): responde assim
 * que chega mensagem nova ou leitura nova (o ✓✓), ou em até 8 s sem mudança. Junto, quantas conversas esta pessoa tem
 * por ler (o ícone do topo). Sem `desde`: a marca atual na hora.
 */
export async function GET(req: NextRequest) {
  const g = await guardaEscritorio("visualizar");
  if (g.resposta) return g.resposta;
  const onde = ondeNovidadesEscritorio(g.quem.empresaId);
  const desde = lerDesde(req.url);
  const r = await esperarNovidades(() => marcaAtual(onde, g.quem.id), desde, { cancelado: () => req.signal.aborted });
  // O contador do topo só se recalcula quando algo mudou (ou na 1ª pergunta): a marca já inclui a leitura desta pessoa
  // Quem tem "Conversas" conta por pessoa (a visão padrão); quem só vê OS, por OS
  const naoLidas = r.mudou || !desde ? await (podeConversas(g.quem, "visualizar") ? pessoasNaoLidas(g.quem) : conversasNaoLidasDoEscritorio(g.quem)) : undefined;
  return NextResponse.json({ ...r, ...(naoLidas !== undefined && { naoLidas }) }, { headers: SEM_CACHE });
}
