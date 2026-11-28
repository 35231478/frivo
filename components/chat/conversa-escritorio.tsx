"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversaChat, type EnvioMensagem } from "@/components/chat/conversa";
import { useNovidades } from "@/components/chat/use-novidades";
import { URL_NOVIDADES_ESCRITORIO } from "@/lib/chat/novidades-cliente";
import { MSG_OS_CANCELADA, somenteLeitura, juntarComFila, type ConversaResumo } from "@/lib/chat/regras";
import { atualizarSino } from "@/lib/ui/sino";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

const novoClientId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 32);
export const urlFotoEscritorio = (id: string) => `/api/conversas/fotos/${encodeURIComponent(id)}`;

/**
 * A conversa de UMA OS no escritório (a tela Conversas e o Resumo da OS usam esta): lê (e marca como lida), atualiza
 * sozinha pelo tempo real, e envia — a mensagem aparece na hora como "Enviando…"; se falhar, fica "Não enviada" com
 * "Tentar de novo" (o mesmo clientId: não duplica).
 */
export function ConversaEscritorio({ osId, podeEscrever, className, aoCarregar }: {
  osId: string;
  podeEscrever: boolean;
  className?: string;
  /** Avisa o resumo (cabeçalho da conversa, contador da lista) a cada leitura */
  aoCarregar?: (c: ConversaResumo) => void;
}) {
  const [servidor, setServidor] = useState<ComentarioTela[]>([]);
  const [locais, setLocais] = useState<(ComentarioTela & { envio: EnvioMensagem })[]>([]);
  const [conversa, setConversa] = useState<ConversaResumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const aoCarregarRef = useRef(aoCarregar);
  aoCarregarRef.current = aoCarregar;

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/conversas/${encodeURIComponent(osId)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.mensagens)) { setErro(j?.erro ?? "Não foi possível carregar a conversa."); return; }
      setErro(null);
      setServidor(j.mensagens);
      setConversa(j.conversa);
      aoCarregarRef.current?.(j.conversa);
      // As que já chegaram ao servidor saem da lista local
      const ja = new Set((j.mensagens as ComentarioTela[]).map((m) => m.clientId));
      setLocais((l) => l.filter((m) => !ja.has(m.clientId)));
      atualizarSino();
    } catch {
      setErro((e) => e ?? null);
    } finally { setCarregando(false); }
  }, [osId]);

  useEffect(() => { setCarregando(true); setServidor([]); setLocais([]); void carregar(); }, [carregar]);
  useNovidades(URL_NOVIDADES_ESCRITORIO, (r) => { if (r.mudou) void carregar(); });

  async function mandar(clientId: string, envio: EnvioMensagem): Promise<string | null> {
    try {
      const r = await fetch(`/api/conversas/${encodeURIComponent(osId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, ...envio }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) return j?.erro ?? "Não foi possível enviar.";
      setServidor((s) => (s.some((m) => m.clientId === clientId) ? s : [...s, j.mensagem]));
      setLocais((l) => l.filter((m) => m.clientId !== clientId));
      return null;
    } catch {
      return "Sem conexão: a mensagem não foi enviada.";
    }
  }

  async function enviar(envio: EnvioMensagem): Promise<string | null> {
    const clientId = novoClientId();
    const local = {
      id: null, clientId, texto: envio.texto, autor: "", origem: "ESCRITORIO" as const, criadoEm: new Date().toISOString(), meu: true, pendente: true,
      foto: envio.miniatura ? { id: null, miniatura: envio.miniatura } : null, envio,
    };
    setLocais((l) => [...l, local]);
    const e = await mandar(clientId, envio);
    // Recusa definitiva (ex.: OS cancelada, foto inválida): devolve o erro à caixa e tira o balão; falha de rede: fica para tentar de novo
    if (e && !e.startsWith("Sem conexão")) { setLocais((l) => l.filter((m) => m.clientId !== clientId)); return e; }
    if (e) setLocais((l) => l.map((m) => (m.clientId === clientId ? { ...m, pendente: false, falhou: e } : m)));
    return null;
  }

  async function tentarDeNovo(m: ComentarioTela) {
    const local = locais.find((x) => x.clientId === m.clientId);
    if (!local) return;
    setLocais((l) => l.map((x) => (x.clientId === m.clientId ? { ...x, pendente: true, falhou: null } : x)));
    const e = await mandar(local.clientId!, local.envio);
    if (e) setLocais((l) => l.map((x) => (x.clientId === m.clientId ? { ...x, pendente: false, falhou: e } : x)));
  }

  return (
    <ConversaChat className={className} mensagens={juntarComFila(servidor, locais)} carregando={carregando} erro={erro && !servidor.length ? erro : null}
      somenteLeitura={somenteLeitura(conversa?.status) ? MSG_OS_CANCELADA : null} podeEscrever={podeEscrever}
      semPermissao="Para escrever nesta conversa é preciso poder editar a OS."
      onEnviar={enviar} onTentarDeNovo={tentarDeNovo} urlFoto={urlFotoEscritorio} />
  );
}
