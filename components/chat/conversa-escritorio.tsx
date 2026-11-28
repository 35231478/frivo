"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversaChat, type EnvioMensagem } from "@/components/chat/conversa";
import { SeletorOs } from "@/components/chat/seletor-os";
import { useNovidades } from "@/components/chat/use-novidades";
import { URL_NOVIDADES_ESCRITORIO } from "@/lib/chat/novidades-cliente";
import { MSG_OS_CANCELADA, somenteLeitura, juntarComFila, type ConversaResumo, type OsDoDia } from "@/lib/chat/regras";
import { atualizarSino } from "@/lib/ui/sino";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

const novoClientId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 32);
export const urlFotoEscritorio = (id: string) => `/api/conversas/fotos/${encodeURIComponent(id)}`;

/** A conversa que o escritório abre: a de uma OS (todos os envolvidos) ou a de uma PESSOA (com e sem OS). */
export type AlvoConversa = { tipo: "os"; osId: string } | { tipo: "pessoa"; usuarioId: string };

/** O que a leitura devolve (para o cabeçalho e a lista) */
export type ResumoConversa = { tipo: "os"; conversa: ConversaResumo } | { tipo: "pessoa"; pessoa: { usuarioId: string; nome: string; avatar: string | null } };

/** Outra OS para a mensagem (o "Outra OS" do seletor): a mesma busca da visão por OS */
async function buscarOs(q: string): Promise<OsDoDia[]> {
  const r = await fetch(`/api/conversas?busca=${encodeURIComponent(q)}`, { cache: "no-store" });
  const j = await r.json().catch(() => null);
  if (!r.ok) return [];
  const comConversa = (j?.conversas ?? []).map((c: ConversaResumo) => ({ osId: c.osId, numero: c.osNumero, cliente: c.cliente, emAndamento: false }));
  const sem = (j?.semConversa ?? []).map((c: { osId: string; osNumero: string; cliente: string }) => ({ osId: c.osId, numero: c.osNumero, cliente: c.cliente, emAndamento: false }));
  return [...comConversa, ...sem].slice(0, 8);
}

/**
 * A conversa no escritório — UM componente para a OS (a tela Conversas na visão OS e o Resumo da OS) e para a PESSOA
 * (a visão padrão). Lê (e marca como lida), atualiza sozinha pelo tempo real, e envia: a mensagem aparece na hora
 * como "Enviando…"; se falhar, fica "Não enviada" com "Tentar de novo" (o mesmo clientId: não duplica).
 * Na conversa da pessoa: a etiqueta da OS em cada grupo de mensagens e o seletor de OS (1 toque; "Sem OS"; "Outra OS").
 */
export function ConversaEscritorio({ alvo, podeEscrever, className, aoCarregar, semPermissao, abrirOs }: {
  alvo: AlvoConversa;
  /** A etiqueta da OS (conversa da pessoa) abre a OS — quem monta decide como navegar */
  abrirOs?: (osId: string) => void;
  podeEscrever: boolean;
  className?: string;
  /** Avisa o cabeçalho e a lista (zera o contador da aberta) a cada leitura */
  aoCarregar?: (r: ResumoConversa) => void;
  semPermissao?: string;
}) {
  const chave = alvo.tipo === "os" ? alvo.osId : alvo.usuarioId;
  const url = alvo.tipo === "os" ? `/api/conversas/${encodeURIComponent(alvo.osId)}` : `/api/conversas/pessoas/${encodeURIComponent(alvo.usuarioId)}`;
  const [servidor, setServidor] = useState<ComentarioTela[]>([]);
  const [locais, setLocais] = useState<(ComentarioTela & { envio: EnvioMensagem & { osId?: string | null } })[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [osDoDia, setOsDoDia] = useState<OsDoDia[]>([]);
  // A OS da próxima mensagem (pessoa): começa na padrão do servidor; a pessoa troca com um toque
  const [osEscolhida, setOsEscolhida] = useState<{ id: string | null; os: OsDoDia | null } | undefined>(undefined);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const aoCarregarRef = useRef(aoCarregar);
  aoCarregarRef.current = aoCarregar;

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.mensagens)) { setErro(j?.erro ?? "Não foi possível carregar a conversa."); return; }
      setErro(null);
      setServidor(j.mensagens);
      if (alvo.tipo === "os") { setStatus(j.conversa?.status ?? null); aoCarregarRef.current?.({ tipo: "os", conversa: j.conversa }); }
      else {
        setOsDoDia(j.osDoDia ?? []);
        setOsEscolhida((atual) => atual ?? { id: j.osPadrao ?? null, os: (j.osDoDia ?? []).find((o: OsDoDia) => o.osId === j.osPadrao) ?? null });
        aoCarregarRef.current?.({ tipo: "pessoa", pessoa: j.pessoa });
      }
      // As que já chegaram ao servidor saem da lista local
      const ja = new Set((j.mensagens as ComentarioTela[]).map((m) => m.clientId));
      setLocais((l) => l.filter((m) => !ja.has(m.clientId)));
      atualizarSino();
    } catch {
      setErro((e) => e ?? null);
    } finally { setCarregando(false); }
  }, [url, alvo.tipo]);

  useEffect(() => { setCarregando(true); setServidor([]); setLocais([]); setOsEscolhida(undefined); void carregar(); }, [carregar, chave]);
  useNovidades(URL_NOVIDADES_ESCRITORIO, (r) => { if (r.mudou) void carregar(); });

  async function mandar(clientId: string, envio: EnvioMensagem & { osId?: string | null }): Promise<string | null> {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, ...envio }) });
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
    const os = alvo.tipo === "pessoa" ? osEscolhida?.os ?? null : null;
    const corpo = alvo.tipo === "pessoa" ? { ...envio, osId: osEscolhida?.id ?? null } : envio;
    const local = {
      id: null, clientId, texto: envio.texto, autor: "", origem: "ESCRITORIO" as const, criadoEm: new Date().toISOString(), meu: true, pendente: true,
      foto: envio.miniatura ? { id: null, miniatura: envio.miniatura } : null, envio: corpo,
      os: os ? { id: os.osId, numero: os.numero, cliente: os.cliente } : null,
    };
    setLocais((l) => [...l, local]);
    const e = await mandar(clientId, corpo);
    // Recusa definitiva (OS cancelada, foto inválida): devolve o erro à caixa e tira o balão; falha de rede: fica para tentar de novo
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

  const daPessoa = alvo.tipo === "pessoa";
  return (
    <ConversaChat className={className} mensagens={juntarComFila(servidor, locais)} carregando={carregando} erro={erro && !servidor.length ? erro : null}
      somenteLeitura={!daPessoa && somenteLeitura(status) ? MSG_OS_CANCELADA : null} podeEscrever={podeEscrever}
      semPermissao={semPermissao ?? "Para escrever nesta conversa é preciso poder editar a OS."}
      onEnviar={enviar} onTentarDeNovo={tentarDeNovo} urlFoto={urlFotoEscritorio}
      mostrarOs={daPessoa} abrirOs={abrirOs}
      acimaDoTexto={daPessoa && osEscolhida !== undefined
        ? <SeletorOs opcoes={osDoDia} valor={osEscolhida.id} onValor={(id, os) => setOsEscolhida({ id, os: os ?? null })} buscar={buscarOs} />
        : undefined} />
  );
}
