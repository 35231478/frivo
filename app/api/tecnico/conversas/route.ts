import { NextResponse } from "next/server";
import { conversaDoTecnicoComEscritorio } from "@/lib/chat/pessoas-servidor";
import { guardaTecnico, SEM_CACHE } from "@/lib/chat/rotas-server";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";

/**
 * GET /api/tecnico/conversas — CHAT-1: a conversa do técnico com o ESCRITÓRIO (uma só; o técnico não escolhe pessoa):
 * as mensagens (com a etiqueta da OS de cada uma, ou sem OS), as OS dele no dia (o seletor de 1 toque) e a OS padrão.
 * Ler marca como lidas. Escrever é pela fila do app (com OS: a atividade dele; sem OS: "sem-os").
 */
export async function GET() {
  const g = await guardaTecnico();
  if (g.resposta) return g.resposta;
  const [r, config] = await Promise.all([conversaDoTecnicoComEscritorio(g.empresaId, g.usuarioId, g.tecnicoId), carregarConfigApp(g.empresaId)]);
  // "Exibir dados do cliente" desligado (Equipes › App do colaborador): o nome do cliente nem sai do servidor
  if (!config.exibirDadosCliente) {
    r.mensagens = r.mensagens.map((m) => (m.os ? { ...m, os: { ...m.os, cliente: "" } } : m));
    r.osDoDia = r.osDoDia.map((o) => ({ ...o, cliente: "" }));
  }
  return NextResponse.json(r, { headers: SEM_CACHE });
}
