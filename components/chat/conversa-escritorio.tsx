"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversaChat, type EnvioMensagem, type InfoEquipamentos } from "@/components/chat/conversa";
import { SeletorOs } from "@/components/chat/seletor-os";
import { useNovidades } from "@/components/chat/use-novidades";
import { URL_NOVIDADES_ESCRITORIO } from "@/lib/chat/novidades-cliente";
import { citacaoDe, MSG_OS_CANCELADA, osDaResposta, somenteLeitura, juntarComFila, type ConversaResumo, type OsDoDia } from "@/lib/chat/regras";
import { atualizarSino } from "@/lib/ui/sino";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import type { EstadoTecnico } from "@/lib/chat/presenca";

const novoClientId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 32);
export const urlFotoEscritorio = (id: string) => `/api/conversas/fotos/${encodeURIComponent(id)}`;

/** A conversa que o escritório abre: a de uma OS (todos os envolvidos) ou a de uma PESSOA (com e sem OS). */
export type AlvoConversa = { tipo: "os"; osId: string } | { tipo: "pessoa"; usuarioId: string };

/** O que a leitura devolve (para o cabeçalho e a lista) */
export type ResumoConversa = { tipo: "os"; conversa: ConversaResumo } | { tipo: "pessoa"; pessoa: { usuarioId: string; nome: string; avatar: string | null; estado?: EstadoTecnico | null } };

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
 * Responder: a resposta herda a OS da citada (a pessoa ainda troca); cancelar a resposta volta à OS de antes.
 */
export function ConversaEscritorio({ alvo, podeEscrever, className, aoCarregar, semPermissao, abrirOs, podeCorrigirFoto = false }: {
  /** CHAT-1.1: corrigir o equipamento da foto e pô-la no relatório (quem edita a OS) */
  podeCorrigirFoto?: boolean;
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
  const [equipamentos, setEquipamentos] = useState<Record<string, InfoEquipamentos>>({});
  // A OS da próxima mensagem (pessoa): começa na padrão do servidor; a pessoa troca com um toque
  const [osEscolhida, setOsEscolhida] = useState<{ id: string | null; os: OsDoDia | null } | undefined>(undefined);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const aoCarregarRef = useRef(aoCarregar);
  aoCarregarRef.current = aoCarregar;
  // Foi até uma citada antiga: as próximas leituras (tempo real) continuam desde ela
  const ate = useRef<string | null>(null);
  // A OS antes de responder (cancelar a resposta volta a ela, se a pessoa não trocou)
  const antesDaCitacao = useRef<{ herdada: string | null; antes: { id: string | null; os: OsDoDia | null } | undefined } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(ate.current ? `${url}?ate=${encodeURIComponent(ate.current)}` : url, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.mensagens)) { setErro(j?.erro ?? "Não foi possível carregar a conversa."); return; }
      setErro(null);
      setServidor(j.mensagens);
      setEquipamentos(j.equipamentosDasOs ?? {});
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

  useEffect(() => { ate.current = null; antesDaCitacao.current = null; setCarregando(true); setServidor([]); setLocais([]); setOsEscolhida(undefined); void carregar(); }, [carregar, chave]);
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

  async function carregarAte(id: string) { ate.current = id; await carregar(); }

  /** CHAT-1.1: corrigir o equipamento da foto, ou pô-la no relatório (a mensagem volta do servidor já como ficou) */
  async function mudarFoto(m: ComentarioTela, corpo: { equipamentoId: string | null } | { noRelatorio: boolean }): Promise<string | null> {
    if (!m.id) return "A mensagem ainda está sendo enviada.";
    try {
      const r = await fetch(`/api/conversas/mensagens/${encodeURIComponent(m.id)}/foto`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => null);
      if (!r.ok) return j?.erro ?? "Não foi possível salvar.";
      setServidor((s) => s.map((x) => (x.id === m.id ? j.mensagem : x)));
      return null;
    } catch {
      return "Sem conexão: tente de novo.";
    }
  }

  /** Responder herda a OS da citada (conversa da pessoa; na da OS, a OS é a própria). Cancelar volta à de antes. */
  function aoCitar(m: ComentarioTela | null) {
    if (alvo.tipo !== "pessoa") return;
    if (m) {
      const herdada = osDaResposta(m);
      antesDaCitacao.current = { herdada, antes: antesDaCitacao.current?.antes ?? osEscolhida };
      setOsEscolhida({ id: herdada, os: m.os ? { osId: m.os.id, numero: m.os.numero, cliente: m.os.cliente, emAndamento: false } : null });
      return;
    }
    const a = antesDaCitacao.current;
    antesDaCitacao.current = null;
    if (a && a.antes && (osEscolhida?.id ?? null) === a.herdada) setOsEscolhida(a.antes);
  }

  async function enviar(envio: EnvioMensagem, citada?: ComentarioTela): Promise<string | null> {
    antesDaCitacao.current = null;
    const clientId = novoClientId();
    const os = alvo.tipo === "pessoa" ? osEscolhida?.os ?? null : null;
    const corpo = alvo.tipo === "pessoa" ? { ...envio, osId: osEscolhida?.id ?? null } : envio;
    const local = {
      id: null, clientId, texto: envio.texto, autor: "", origem: "ESCRITORIO" as const, criadoEm: new Date().toISOString(), meu: true, pendente: true,
      foto: envio.miniatura ? { id: null, miniatura: envio.miniatura } : null, envio: corpo,
      os: os ? { id: os.osId, numero: os.numero, cliente: os.cliente } : null,
      respostaA: citada ? citacaoDe(citada) : null,
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
  // A OS herdada de uma citada que não é do dia entra como opção do seletor
  const opcoes = osEscolhida?.os && !osDoDia.some((o) => o.osId === osEscolhida.os!.osId) ? [...osDoDia, osEscolhida.os] : osDoDia;
  return (
    <ConversaChat className={className} mensagens={juntarComFila(servidor, locais)} carregando={carregando} erro={erro && !servidor.length ? erro : null}
      somenteLeitura={!daPessoa && somenteLeitura(status) ? MSG_OS_CANCELADA : null} podeEscrever={podeEscrever}
      semPermissao={semPermissao ?? "Para escrever nesta conversa é preciso poder editar a OS."}
      onEnviar={enviar} onTentarDeNovo={tentarDeNovo} urlFoto={urlFotoEscritorio}
      mostrarOs={daPessoa} abrirOs={abrirOs} onCitar={aoCitar} carregarAte={carregarAte}
      origem="ESCRITORIO" osDaMensagem={alvo.tipo === "os" ? alvo.osId : osEscolhida?.id ?? null} equipamentosDaOs={(id) => equipamentos[id]}
      onCorrigirEquipamento={podeCorrigirFoto ? (m, equipamentoId) => mudarFoto(m, { equipamentoId }) : undefined}
      onRelatorio={podeCorrigirFoto ? (m, noRelatorio) => mudarFoto(m, { noRelatorio }) : undefined}
      acimaDoTexto={daPessoa && osEscolhida !== undefined
        ? <SeletorOs opcoes={opcoes} valor={osEscolhida.id} onValor={(id, os) => setOsEscolhida({ id, os: os ?? null })} buscar={buscarOs} />
        : undefined} />
  );
}
