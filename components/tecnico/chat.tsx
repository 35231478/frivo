"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, ClipboardList, MessageCircle, RefreshCw, Search, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaBR } from "@/lib/fuso";
import { Dica } from "@/components/ui/dica";
import { ConversaChat, type EnvioMensagem } from "@/components/chat/conversa";
import { useNovidades } from "@/components/chat/use-novidades";
import { URL_NOVIDADES_APP } from "@/lib/chat/novidades-cliente";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { MotorSync, novoClientId } from "@/lib/tecnico/offline/motor";
import { MSG_SEM_ESPACO } from "@/lib/tecnico/offline/armazenamento";
import { comentarioSchema, type ComentarioTela } from "@/lib/tecnico/comentarios";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";
import {
  filtrarConversas, horaDaLista, juntarComFila, MSG_OS_CANCELADA, MSG_SEM_CONVERSA, somenteLeitura, textoDaUltima, type ConversaResumo,
} from "@/lib/chat/regras";
import {
  CHAVE_CONVERSAS, CHAVE_CONVERSAS_GUARDADAS, chaveConversa, confirmadasForaDaConversa, conversaValida, dicaNaoLidas, lembrarConversa, listaValida,
  mensagensDaFila, mensagensSumidas, MSG_CONVERSA_SEM_SINAL, MSG_LISTA_SEM_SINAL, MSG_SEM_ATIVIDADE, rotuloNaoLidas, semCliente, URL_CONVERSAS_APP,
  urlConversaApi, urlFotoApp, type RespostaConversa, type RespostaConversas,
} from "@/lib/tecnico/chat";

type Carga<T> = { dados: T | null; baixadoEm: number | null; doAparelho: boolean };

/* ───────── A lista de conversas: UMA por aparelho (a barra inferior e a tela Chat leem a mesma) ───────── */

const ouvintes = new Set<(c: Carga<RespostaConversas>) => void>();
const emCurso = new WeakMap<MotorSync, Promise<Carga<RespostaConversas>>>();
const maisUma = new WeakSet<MotorSync>();
const ultimaCarga = new WeakMap<MotorSync, Carga<RespostaConversas>>();

/**
 * Baixa a lista (guarda no aparelho; sem sinal, devolve a guardada) e avisa todos que a leem. Um pedido por vez:
 * quem chega no meio recebe o mesmo resultado; com `deNovo` (algo mudou depois de o pedido sair), sai mais um no fim.
 */
function atualizarConversas(motor: MotorSync, deNovo = false): Promise<Carga<RespostaConversas>> {
  const ja = emCurso.get(motor);
  if (ja) { if (deNovo) maisUma.add(motor); return ja; }
  const p = motor.baixarLista<RespostaConversas>(CHAVE_CONVERSAS, URL_CONVERSAS_APP)
    .then((c) => { ultimaCarga.set(motor, c); for (const o of [...ouvintes]) o(c); return c; })
    // O banco do aparelho fechou (troca de usuário) ou não abriu: fica o que já havia
    .catch(() => ultimaCarga.get(motor) ?? { dados: null, baixadoEm: null, doAparelho: true })
    .finally(() => {
      emCurso.delete(motor);
      if (maisUma.delete(motor)) void atualizarConversas(motor);
    });
  emCurso.set(motor, p);
  return p;
}

/** A lista de conversas do técnico (servidor, ou a guardada sem sinal), em tempo real enquanto o app está aberto. */
export function useConversas() {
  const { motor } = useTecnico();
  const [carga, setCarga] = useState<Carga<RespostaConversas> | null>(() => (motor ? ultimaCarga.get(motor) ?? null : null));
  const [atualizando, setAtualizando] = useState(false);
  useEffect(() => { ouvintes.add(setCarga); return () => { ouvintes.delete(setCarga); }; }, []);
  const carregar = useCallback(async (deNovo = false) => {
    if (!motor) return;
    setAtualizando(true);
    try { await atualizarConversas(motor, deNovo); } finally { setAtualizando(false); }
  }, [motor]);
  useEffect(() => { void carregar(); }, [carregar]);
  // O sinal voltou: a lista (e o contador) se atualizam sozinhos
  useEffect(() => {
    const aoVoltar = () => { void carregar(true); };
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, [carregar]);
  const dados = listaValida(carga?.dados) ? carga!.dados : null;
  // Tempo real: só depois de o servidor (ou o aparelho) ter uma lista do chat — sem ela não há o que acompanhar
  useNovidades(URL_NOVIDADES_APP, (r) => { if (r.mudou) void carregar(true); }, !!motor && !!dados);
  return { carga, dados, carregar, atualizando };
}

/** O contador do item "Chat" da barra inferior (mensagens não lidas), atualizado em tempo real. */
export function useNaoLidasChat(): number {
  const { dados } = useConversas();
  return dados?.naoLidas ?? 0;
}

/** O selo do contador (barra inferior e cada linha da lista) */
export function SeloNaoLidas({ n, className }: { n: number; className?: string }) {
  const r = rotuloNaoLidas(n);
  if (!r) return null;
  return (
    <span className={cn("min-w-5 h-5 px-1.5 rounded-full bg-acento text-white text-[11px] font-bold leading-5 text-center", className)}
      aria-label={dicaNaoLidas(n)} title={dicaNaoLidas(n)} data-nao-lidas={n}>{r}</span>
  );
}

/* ───────── A vista Chat ───────── */

/** CHAT-1: a tela Chat do app — a lista de conversas (uma por OS) ou, com `os`, a conversa daquela OS. */
export function VistaChat({ os }: { os?: string | null }) {
  return os ? <ConversaDaOs key={os} osId={os} /> : <ListaConversas />;
}

function AvisoGuardado({ baixadoEm, texto }: { baixadoEm: number | null; texto: string }) {
  return (
    <p className="flex items-center gap-1.5 rounded-lg bg-atencao-claro px-3 py-2 text-xs text-atencao-texto" data-aviso-aparelho>
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden /> {texto}{baixadoEm ? ` (às ${horaBR(baixadoEm)})` : ""}.
    </p>
  );
}

function ListaConversas() {
  const { config } = useTecnico();
  const { carga, dados, carregar, atualizando } = useConversas();
  const [busca, setBusca] = useState("");
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const todas = useMemo(() => (dados?.conversas ?? []).map((c) => semCliente(c, config.exibirDadosCliente)), [dados, config.exibirDadosCliente]);
  const lista = useMemo(() => filtrarConversas(todas, busca, soNaoLidas), [todas, busca, soNaoLidas]);
  const comNaoLidas = todas.filter((c) => c.naoLidas > 0).length;

  return (
    <div className="space-y-3" data-vista="chat" data-chat-lista>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-1.5">
          Chat
          <Dica rotulo="Chat" texto="Uma conversa por OS com o escritório. A conversa é interna: o cliente não vê. Sem sinal, a mensagem fica no aparelho e sobe sozinha quando o sinal voltar." />
        </h1>
        <button type="button" onClick={() => void carregar(true)} disabled={atualizando} data-atualizar-chat
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 px-2 touch-target">
          <RefreshCw className={cn("w-3.5 h-3.5", atualizando && "animate-spin")} aria-hidden /> Atualizar
        </button>
      </header>

      {carga?.doAparelho && dados && <AvisoGuardado baixadoEm={carga.baixadoEm} texto="Sem sinal: lista da última sincronização" />}

      <div className="space-y-2">
        <label className="relative block">
          <span className="sr-only">Pesquisar conversa</span>
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar por OS, cliente, técnico ou mensagem" data-busca-chat
            className="w-full rounded-card border border-surface-border bg-white pl-9 pr-3 h-11 text-base focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
        </label>
        <div className="flex gap-2" role="group" aria-label="Filtro das conversas">
          {([[false, "Todas"], [true, "Não lidas"]] as const).map(([v, rotulo]) => (
            <button key={rotulo} type="button" onClick={() => setSoNaoLidas(v)} aria-pressed={soNaoLidas === v} data-filtro-chat={v ? "nao-lidas" : "todas"}
              className={cn("rounded-full border px-3.5 text-sm font-semibold touch-target",
                soNaoLidas === v ? "bg-primary-600 border-primary-600 text-white" : "bg-white border-surface-border text-ink-muted")}>
              {rotulo}{v && comNaoLidas > 0 ? ` (${comNaoLidas})` : ""}
            </button>
          ))}
        </div>
      </div>

      {!carga ? (
        <div className="space-y-2" data-carregando aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-card bg-white border border-surface-border animate-pulse" />)}</div>
      ) : !dados ? (
        <div className="rounded-card bg-white border border-surface-border p-6 text-center space-y-2" data-sem-dados>
          <WifiOff className="w-8 h-8 text-ink-subtle mx-auto" aria-hidden />
          <p className="font-semibold text-ink">{MSG_LISTA_SEM_SINAL}</p>
          <button type="button" onClick={() => void carregar(true)} disabled={atualizando} className="text-sm font-semibold text-primary-700 px-3 touch-target">Tentar de novo</button>
        </div>
      ) : !lista.length ? (
        <p className="rounded-card bg-white border border-surface-border p-6 text-center text-sm text-ink-muted" data-chat-vazio>
          {todas.length ? (soNaoLidas && !busca.trim() ? "Nenhuma conversa com mensagem não lida." : "Nenhuma conversa encontrada.") : "Nenhuma conversa ainda. As OS em aberto aparecem aqui."}
        </p>
      ) : (
        <ul className="rounded-card bg-white border border-surface-border divide-y divide-surface-border overflow-hidden">
          {lista.map((c) => <LinhaConversa key={c.osId} c={c} />)}
        </ul>
      )}
    </div>
  );
}

function LinhaConversa({ c }: { c: ConversaResumo }) {
  return (
    <li>
      <button type="button" onClick={() => irPara({ ver: "chat", os: c.osId })} data-conversa-linha={c.osId} data-nao-lidas-linha={c.naoLidas || undefined}
        className="w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-surface-alt active:bg-surface-alt touch-target">
        <span className="shrink-0 w-10 h-10 rounded-full bg-primary-50 text-primary-700 inline-flex items-center justify-center" aria-hidden>
          <MessageCircle className="w-5 h-5" />
        </span>
        <span className="flex-1 min-w-0 space-y-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className={cn("text-ink", c.naoLidas ? "font-bold" : "font-semibold")} data-os-numero>{c.osNumero}</span>
              {c.cliente && <span className="text-ink-muted" data-cliente> · {c.cliente}</span>}
            </span>
            {c.ultima && <span className={cn("shrink-0 text-xs", c.naoLidas ? "text-acento font-semibold" : "text-ink-subtle")} data-hora>{horaDaLista(c.ultima.criadoEm)}</span>}
          </span>
          {c.tecnicos.length > 0 && <span className="block text-xs text-ink-subtle truncate" data-tecnicos>{c.tecnicos.join(", ")}</span>}
          <span className="flex items-center justify-between gap-2">
            <span className={cn("min-w-0 truncate text-sm inline-flex items-center gap-1", c.naoLidas ? "text-ink" : "text-ink-muted")} data-ultima>
              {c.ultima?.minha && (
                <span className="inline-flex shrink-0 text-ink-subtle" title="Minha mensagem" aria-label="Minha mensagem" data-minha-ultima>
                  <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
                </span>
              )}
              <span className="truncate">{textoDaUltima(c.ultima)}</span>
            </span>
            <SeloNaoLidas n={c.naoLidas} className="shrink-0" />
          </span>
        </span>
      </button>
    </li>
  );
}

/* ───────── A conversa de uma OS ───────── */

/** Guarda esta conversa entre as últimas abertas no aparelho (as que passam do limite saem). */
async function guardarEntreRecentes(motor: MotorSync, osId: string) {
  try {
    const { lista, sair } = lembrarConversa(await motor.banco.ler<string[]>(CHAVE_CONVERSAS_GUARDADAS), osId);
    await motor.banco.gravar(CHAVE_CONVERSAS_GUARDADAS, lista);
    await motor.banco.apagar(sair.map(chaveConversa));
  } catch { /* guardar é conveniência: nunca atrapalha a conversa */ }
}

function ConversaDaOs({ osId }: { osId: string }) {
  const { motor, estado, usuario, config } = useTecnico();
  const { dados: lista } = useConversas();
  const [carga, setCarga] = useState<Carga<RespostaConversa> | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  // A que saiu da fila (o servidor confirmou e o retrato novo chegou) segue "Enviando…" até a conversa trazê-la com o ✓;
  // `pedido` = o 1º pedido da conversa feito depois de ela sair da fila (o que a traz)
  const [sumidas, setSumidas] = useState<{ m: ComentarioTela; pedido: number }[]>([]);
  const pedido = useRef(0);
  const atualizouLista = useRef(false);

  const carregar = useCallback(async () => {
    if (!motor) return;
    const n = ++pedido.current;
    let x: Carga<RespostaConversa>;
    try { x = await motor.baixarLista<RespostaConversa>(chaveConversa(osId), urlConversaApi(osId)); } catch { x = { dados: null, baixadoEm: null, doAparelho: true }; }
    if (n !== pedido.current) return; // outro pedido saiu depois (ou a conversa fechou): vale o mais novo
    const ok = conversaValida(x.dados);
    setCarga({ ...x, dados: ok ? x.dados : null });
    setMotivo(ok ? null : motor.atual.situacao === "offline" ? MSG_CONVERSA_SEM_SINAL : MSG_SEM_CONVERSA);
    if (ok && !x.doAparelho) {
      setSumidas((s) => s.filter((m) => m.pedido > n));
      void guardarEntreRecentes(motor, osId);
      // Abrir marca como lidas: o contador da barra acompanha na hora
      if (!atualizouLista.current) { atualizouLista.current = true; void atualizarConversas(motor, true); }
    }
  }, [motor, osId]);
  useEffect(() => { void carregar(); return () => { pedido.current += 1; }; }, [carregar]);
  // Tempo real: chegou mensagem (ou alguém leu): recarrega a conversa aberta
  useNovidades(URL_NOVIDADES_APP, (r) => { if (r.mudou) void carregar(); }, !!motor);

  // A fila do aparelho (relida a cada mudança do motor): o que foi escrito aqui e ainda não subiu
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    motor.banco.fila().then((f) => { if (vivo) setFila(f); }, () => { /* banco fechado: fica a última lida */ });
    return () => { vivo = false; };
  }, [motor, estado.versao]);

  const resumo = carga?.dados?.conversa ?? lista?.conversas.find((c) => c.osId === osId) ?? null;
  const atividadeIds = useMemo(() => resumo?.atividadeIds?.length ? resumo.atividadeIds : resumo?.atividadeId ? [resumo.atividadeId] : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(resumo?.atividadeIds ?? []).join(","), resumo?.atividadeId]);
  const servidor = useMemo(() => carga?.dados?.mensagens ?? [], [carga]);
  const daFila = useMemo(() => mensagensDaFila(fila, atividadeIds, usuario.nome), [fila, atividadeIds, usuario.nome]);

  const antes = useRef<ComentarioTela[]>([]);
  const pedidas = useRef(new Set<string>());
  useEffect(() => {
    const saiu = mensagensSumidas(antes.current, daFila, servidor);
    antes.current = daFila;
    const seguram = saiu.filter((m) => !m.falhou);
    if (seguram.length) setSumidas((s) => [...s, ...seguram.map((m) => ({ m, pedido: pedido.current + 1 }))]);
    const confirmadas = [...confirmadasForaDaConversa(fila, atividadeIds, servidor), ...saiu.map((m) => m.clientId!)].filter((id) => !pedidas.current.has(id));
    if (confirmadas.length) { for (const id of confirmadas) pedidas.current.add(id); void carregar(); }
  }, [daFila, fila, atividadeIds, servidor, carregar]);

  const mensagens = useMemo(() => {
    const ids = new Set(daFila.map((m) => m.clientId));
    return juntarComFila(servidor, [...daFila, ...sumidas.map((s) => s.m).filter((m) => !ids.has(m.clientId))]);
  }, [servidor, daFila, sumidas]);

  const atividadeId = resumo?.atividadeId ?? atividadeIds[0] ?? null;

  async function enviar(d: EnvioMensagem): Promise<string | null> {
    if (!motor) return MSG_SEM_ESPACO;
    if (!atividadeId) return MSG_SEM_ATIVIDADE;
    const dados = { clientId: novoClientId(), texto: d.texto, ...(d.foto && d.miniatura && { foto: d.foto, miniatura: d.miniatura }) };
    const v = comentarioSchema.safeParse(dados);
    if (!v.success) return v.error.issues[0]?.message ?? MSG_SEM_ESPACO;
    try {
      await motor.registrar([{ tipo: "comentario", atividadeId, dados: v.data }]);
    } catch {
      return MSG_SEM_ESPACO; // o aparelho não guardou: nunca finge que enviou
    }
    setFila(await motor.banco.fila());
    return null;
  }

  const cliente = config.exibirDadosCliente ? resumo?.cliente : "";
  return (
    <div className="flex flex-col -mx-4 -mt-4 -mb-24 h-[calc(100dvh-8rem-env(safe-area-inset-bottom))]" data-vista="chat" data-chat-conversa={osId}>
      <header className="flex items-center gap-1 border-b border-surface-border bg-white px-1 py-1.5">
        <button type="button" onClick={() => irPara({ ver: "chat" })} aria-label="Voltar para as conversas" data-voltar-chat
          className="shrink-0 rounded-full w-11 h-11 inline-flex items-center justify-center text-ink-muted hover:bg-surface-alt touch-target">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-ink truncate" data-chat-titulo>
            {resumo?.osNumero ?? "Conversa"}{cliente ? <span className="font-medium text-ink-muted"> · {cliente}</span> : null}
          </p>
          {!!resumo?.tecnicos.length && <p className="text-xs text-ink-subtle truncate" data-chat-tecnicos>{resumo.tecnicos.join(", ")}</p>}
        </div>
        {atividadeId && (
          <button type="button" onClick={() => irPara({ ver: "os", a: atividadeId })} data-abrir-os
            className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-primary-700 hover:bg-surface-alt touch-target">
            <ClipboardList className="w-4 h-4" aria-hidden /> Abrir a OS
          </button>
        )}
      </header>
      {carga?.doAparelho && carga.dados && (
        <div className="px-3 pt-2 bg-surface-page"><AvisoGuardado baixadoEm={carga.baixadoEm} texto="Sem sinal: conversa da última sincronização" /></div>
      )}
      {carga && !carga.dados && !resumo ? (
        <div className="flex-1 flex items-center justify-center p-6" data-sem-dados>
          <p className="text-center text-sm text-ink-muted">{motivo ?? MSG_SEM_CONVERSA}</p>
        </div>
      ) : (
        <>
          {carga && !carga.dados && resumo && motivo === MSG_CONVERSA_SEM_SINAL && (
            <div className="px-3 pt-2 bg-surface-page"><AvisoGuardado baixadoEm={null} texto="Sem sinal: as mensagens anteriores aparecem quando o sinal voltar" /></div>
          )}
          <ConversaChat className="flex-1" mensagens={mensagens} carregando={!carga} somenteLeitura={somenteLeitura(resumo?.status) ? MSG_OS_CANCELADA : null}
            onEnviar={enviar} urlFoto={urlFotoApp} onTentarDeNovo={() => { void motor?.tentarDeNovo(); }} placeholder="Escreva para o escritório" />
        </>
      )}
    </div>
  );
}
