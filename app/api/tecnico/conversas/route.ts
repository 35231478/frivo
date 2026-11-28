import { NextResponse } from "next/server";
import { conversasDoTecnico, semCliente } from "@/lib/chat/servidor";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { guardaTecnico, SEM_CACHE } from "@/lib/chat/rotas-server";
import { totalNaoLidas } from "@/lib/chat/regras";

/** GET /api/tecnico/conversas — CHAT-1: as conversas do técnico (as OS dele), com a atividade por onde a mensagem sobe na fila. */
export async function GET() {
  const g = await guardaTecnico();
  if (g.resposta) return g.resposta;
  const [lista, config] = await Promise.all([conversasDoTecnico(g.empresaId, g.usuarioId, g.tecnicoId), carregarConfigApp(g.empresaId)]);
  const conversas = lista.map((c) => semCliente(c, config.exibirDadosCliente));
  return NextResponse.json({ conversas, naoLidas: totalNaoLidas(conversas) }, { headers: SEM_CACHE });
}
