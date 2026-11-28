"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaBR } from "@/lib/fuso";
import { Dica } from "@/components/ui/dica";
import { ConversaChat, type EnvioMensagem } from "@/components/chat/conversa";
import { SeletorOs } from "@/components/chat/seletor-os";
import { useNovidades } from "@/components/chat/use-novidades";
import { useAreaVisivel } from "@/components/tecnico/use-area-visivel";
import { URL_NOVIDADES_APP } from "@/lib/chat/novidades-cliente";
import { juntarComFila, osDaResposta, refDaCitada } from "@/lib/chat/regras";
import { lerQrDaFoto } from "@/lib/qr/leitor";
import { equipamentoDoQr } from "@/lib/tecnico/offline/estado";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { MSG_SEM_ESPACO } from "@/lib/tecnico/offline/armazenamento";
import { comentarioSchema, type ComentarioTela } from "@/lib/tecnico/comentarios";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";
import {
  aplicarCorrecoesDaFila, atividadeDaOs, atividadeDoEnvio, numeroDaOs, CHAVE_CONVERSA, confirmadasForaDaConversa, conversaValida, dicaNaoLidas, mapaDeAtividades, mensagensDaFila,
  mensagensSumidas, MSG_CONVERSA_SEM_SINAL, opcoesDoSeletor, osDoSeletor, precisaRecarregar, rotuloNaoLidas, semCliente, urlConversaAte, urlFotoApp,
  type OsEtiqueta, type RespostaConversa,
} from "@/lib/tecnico/chat";

type Carga = { dados: RespostaConversa | null; baixadoEm: number | null; doAparelho: boolean };
type AtividadeGuardada = { atividadeId: string; osId: string; osNumero: string; cliente: string };
type QrGuardado = { equipamentoId: string; valor: (lido: string) => boolean };
export const MSG_SEM_ATIVIDADE_NA_OS = "Sem atividade sua nesta OS neste aparelho: o escritório corrige o equipamento.";

/**
 * O contador do item "Chat" da barra inferior: o que o escritório mandou e o técnico não leu. Vem do tempo real (o
 * mesmo laço que a conversa assina), em qualquer vista — sem baixar a conversa, que marcaria como lida.
 */
export function useNaoLidasChat(): number {
  const { motor } = useTecnico();
  const [n, setN] = useState(0);
  useNovidades(URL_NOVIDADES_APP, (r) => { if (typeof r.naoLidas === "number") setN(r.naoLidas); }, !!motor);
  return n;
}

/** O selo do contador (barra inferior) */
export function SeloNaoLidas({ n, className }: { n: number; className?: string }) {
  const r = rotuloNaoLidas(n);
  if (!r) return null;
  return (
    <span className={cn("min-w-5 h-5 px-1.5 rounded-full bg-acento text-white text-[11px] font-bold leading-5 text-center", className)}
      aria-label={dicaNaoLidas(n)} title={dicaNaoLidas(n)} data-nao-lidas={n}>{r}</span>
  );
}

function AvisoGuardado({ texto }: { texto: string }) {
  return (
    <p className="flex items-center gap-1.5 rounded-lg bg-atencao-claro px-3 py-2 text-xs text-atencao-texto" data-aviso-aparelho>
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden /> {texto}
    </p>
  );
}

/**
 * CHAT-1: a tela Chat do app — UMA conversa, com o "Escritório" (o técnico não escolhe pessoa; quem responde aparece
 * no balão). Cada mensagem leva a OS dela: a etiqueta discreta mostra a OS quando muda (e abre a execução); o seletor
 * de 1 toque acima do campo escolhe a OS da próxima (começa na OS padrão do servidor). Escrever é pela fila do aparelho
 * (com ou sem sinal); sem sinal, a conversa guardada no aparelho.
 */
export function VistaChat() {
  const { motor, estado, usuario, config } = useTecnico();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  const [guardadas, setGuardadas] = useState<AtividadeGuardada[]>([]);
  // CHAT-1.1: os QR codes dos equipamentos das unidades guardadas no aparelho (a prévia do QR lido na foto, sem sinal)
  const [qrsGuardados, setQrsGuardados] = useState<QrGuardado[]>([]);
  // A OS que o técnico escolheu no seletor (undefined = ainda não escolheu: vale a OS padrão do servidor)
  const [escolha, setEscolha] = useState<string | null | undefined>(undefined);
  // Responder herda a OS da citada (entra no seletor); cancelar volta à escolha de antes, se o técnico não trocou
  const [herdada, setHerdada] = useState<OsEtiqueta | null>(null);
  const antesDaCitacao = useRef<{ herdada: string | null; antes: string | null | undefined } | null>(null);
  // Foi até uma citada antiga: as próximas leituras continuam desde ela
  const ate = useRef<string | null>(null);
  // A que saiu da fila (o servidor confirmou) segue "Enviando…" até a conversa trazê-la com o ✓;
  // `pedido` = o 1º pedido da conversa feito depois de ela sair da fila (o que a traz)
  const [sumidas, setSumidas] = useState<{ m: ComentarioTela; pedido: number }[]>([]);
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    if (!motor) return;
    const n = ++pedido.current;
    setAtualizando(true);
    let x: Carga;
    try { x = await motor.baixarLista<RespostaConversa>(CHAVE_CONVERSA, urlConversaAte(ate.current)); } catch { x = { dados: null, baixadoEm: null, doAparelho: true }; }
    if (n !== pedido.current) return; // outro pedido saiu depois (ou a tela fechou): vale o mais novo
    setAtualizando(false);
    const ok = conversaValida(x.dados);
    setCarga({ ...x, dados: ok ? x.dados : null });
    if (ok && !x.doAparelho) setSumidas((s) => s.filter((m) => m.pedido > n));
  }, [motor]);
  useEffect(() => { void carregar(); return () => { pedido.current += 1; }; }, [carregar]);
  // O sinal voltou: a conversa se atualiza sozinha
  useEffect(() => {
    const aoVoltar = () => { void carregar(); };
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, [carregar]);
  // Tempo real: chegou mensagem (ou alguém leu): recarrega. A leitura do próprio técnico (que a recarga muda) não conta
  const marca = useRef<string | null>(null);
  useNovidades(URL_NOVIDADES_APP, (r) => {
    const antes = marca.current;
    marca.current = r.marca;
    if (precisaRecarregar(antes, r.marca)) void carregar();
  }, !!motor);

  // A fila do aparelho e as atividades guardadas (relidas a cada mudança do motor): o que foi escrito aqui e ainda não subiu
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    motor.banco.fila().then((f) => { if (vivo) setFila(f); }, () => { /* banco fechado: fica a última lida */ });
    motor.banco.retratos().then((rs) => {
      if (!vivo) return;
      setGuardadas(rs.map(({ retrato: { cartao: c } }) => ({ atividadeId: c.atividadeId, osId: c.osId, osNumero: c.osNumero, cliente: c.cliente })));
      setQrsGuardados(rs.flatMap(({ retrato: r }) => r.equipamentosUnidade.filter((e) => e.qr).map((e) => ({ equipamentoId: e.id, valor: (lido: string) => equipamentoDoQr(r, lido)?.id === e.id }))));
    }, () => { /* idem */ });
    return () => { vivo = false; };
  }, [motor, estado.versao]);

  const dados = useMemo(() => (carga?.dados ? semCliente(carga.dados, config.exibirDadosCliente) : null), [carga, config.exibirDadosCliente]);
  const osDoDia = useMemo(() => dados?.osDoDia ?? [], [dados]);
  const atividades = useMemo(() => {
    const daConversa = (dados?.atividadesDasOs ?? []).flatMap((o) => (o.atividadeId ? [{ atividadeId: o.atividadeId, osId: o.osId, osNumero: o.numero, cliente: o.cliente }] : []));
    return mapaDeAtividades(osDoDia, [...daConversa, ...(config.exibirDadosCliente ? guardadas : guardadas.map((g) => ({ ...g, cliente: "" })))]);
  }, [dados, osDoDia, guardadas, config.exibirDadosCliente]);
  const servidor = useMemo(() => dados?.mensagens ?? [], [dados]);
  const equipamentos = useMemo(() => dados?.equipamentosDasOs ?? {}, [dados]);
  const daFila = useMemo(() => mensagensDaFila(fila, atividades, usuario.nome, equipamentos), [fila, atividades, usuario.nome, equipamentos]);

  const antes = useRef<ComentarioTela[]>([]);
  const pedidas = useRef(new Set<string>());
  useEffect(() => {
    const saiu = mensagensSumidas(antes.current, daFila, servidor);
    antes.current = daFila;
    const seguram = saiu.filter((m) => !m.falhou);
    if (seguram.length) setSumidas((s) => [...s, ...seguram.map((m) => ({ m, pedido: pedido.current + 1 }))]);
    const confirmadas = [...confirmadasForaDaConversa(fila, servidor), ...saiu.map((m) => m.clientId!)].filter((id) => !pedidas.current.has(id));
    if (confirmadas.length) { for (const id of confirmadas) pedidas.current.add(id); void carregar(); }
  }, [daFila, fila, servidor, carregar]);

  const mensagens = useMemo(() => {
    const ids = new Set(daFila.map((m) => m.clientId));
    // CHAT-1.1: a correção do equipamento da foto que ainda está na fila já vale na tela
    return aplicarCorrecoesDaFila(juntarComFila(servidor, [...daFila, ...sumidas.map((s) => s.m).filter((m) => !ids.has(m.clientId))]), fila, equipamentos);
  }, [servidor, daFila, sumidas, fila, equipamentos]);

  const opcoes = useMemo(() => opcoesDoSeletor(osDoDia, herdada, atividades), [osDoDia, herdada, atividades]);
  const osEscolhida = osDoSeletor(escolha, dados?.osPadrao, opcoes);

  /** Responder: a OS vem da citada (sem atividade dele nela, sem OS); cancelar volta à escolha de antes */
  function aoCitar(m: ComentarioTela | null) {
    if (m) {
      const os = osDaResposta(m);
      antesDaCitacao.current = { herdada: os, antes: antesDaCitacao.current ? antesDaCitacao.current.antes : escolha };
      setHerdada(m.os ?? null);
      setEscolha(os);
      return;
    }
    const a = antesDaCitacao.current;
    antesDaCitacao.current = null;
    if (a && (escolha ?? null) === a.herdada) setEscolha(a.antes);
  }

  async function carregarAte(id: string) { ate.current = id; await carregar(); }

  async function enviar(d: EnvioMensagem): Promise<string | null> {
    if (!motor) return MSG_SEM_ESPACO;
    const v = comentarioSchema.safeParse({
      clientId: novoClientId(), texto: d.texto, ...(d.foto && d.miniatura && { foto: d.foto, miniatura: d.miniatura }), ...(d.respostaA && { respostaA: d.respostaA }),
      ...(d.foto && d.equipamentoId !== undefined && { equipamentoId: d.equipamentoId }), ...(d.foto && d.qr && { qr: d.qr }),
    });
    if (!v.success) return v.error.issues[0]?.message ?? MSG_SEM_ESPACO;
    try {
      await motor.registrar([{ tipo: "comentario", atividadeId: atividadeDoEnvio(osEscolhida, opcoes), dados: v.data, osNumero: numeroDaOs(osEscolhida, opcoes) }]);
    } catch {
      return MSG_SEM_ESPACO; // o aparelho não guardou: nunca finge que enviou
    }
    antesDaCitacao.current = null;
    setEscolha(osEscolhida); // a próxima vai na mesma OS (ou sem OS)
    setFila(await motor.banco.fila());
    return null;
  }

  /** O QR lido na foto, no aparelho: só se for de um equipamento desta OS (o resto o servidor confere) */
  function resolverQr(valor: string) {
    const lista = osEscolhida ? equipamentos[osEscolhida]?.equipamentos ?? [] : [];
    const g = qrsGuardados.find((q) => q.valor(valor) && lista.some((e) => e.id === q.equipamentoId));
    const e = g && lista.find((x) => x.id === g.equipamentoId);
    return e ? { equipamentoId: e.id, mesmoCliente: true, titulo: e.titulo } : null;
  }

  /** Corrigir o equipamento de uma foto: pela fila (sem sinal também), pela atividade dele naquela OS */
  async function corrigirEquipamento(m: ComentarioTela, equipamentoId: string | null): Promise<string | null> {
    const atividadeId = m.os ? atividadeDaOs(m.os.id, opcoes, atividades) : null;
    const ref = refDaCitada(m);
    if (!motor || !atividadeId || !ref) return MSG_SEM_ATIVIDADE_NA_OS;
    try {
      await motor.registrar([{ tipo: "fotoChatEquipamento", atividadeId, dados: { comentario: ref, equipamentoId } }]);
    } catch {
      return MSG_SEM_ESPACO;
    }
    setFila(await motor.banco.fila());
    return null;
  }

  /**
   * A mensagem RECUSADA pela fila (regra, não rede): reenviar noutra OS (ou sem OS) com o MESMO conteúdo e o mesmo
   * clientId — ela nunca chegou ao servidor —, ou descartar. Primeiro entra a nova, depois sai a recusada: nada se perde.
   */
  const recusaDaFila = (m: ComentarioTela) => fila.find((o) => o.tipo === "comentario" && o.estado === "erro" && o.dados.clientId === m.clientId);
  async function reenviar(m: ComentarioTela, osId: string | null) {
    const op = recusaDaFila(m);
    if (!motor || !op || op.tipo !== "comentario") return;
    try {
      await motor.registrar([{ tipo: "comentario", atividadeId: atividadeDoEnvio(osId, osDoDia), dados: op.dados, osNumero: numeroDaOs(osId, osDoDia) }]);
      await motor.descartar(op.seq!);
    } finally {
      setFila(await motor.banco.fila());
    }
  }
  async function descartar(m: ComentarioTela) {
    const op = recusaDaFila(m);
    if (!motor || !op) return;
    await motor.descartar(op.seq!);
    setFila(await motor.banco.fila());
  }

  // A etiqueta abre a execução da OS quando há uma atividade dele nela (a do dia; senão a guardada no aparelho)
  const abrirOs = atividades.size
    ? (osId: string) => { const a = atividadeDaOs(osId, osDoDia, atividades); if (a) irPara({ ver: "os", a }); }
    : undefined;
  const semSinal = motor?.atual.situacao === "offline";
  // A conversa ocupa EXATAMENTE o que se vê entre o topo do app e a barra inferior (ou o teclado): medidos, não somados
  // (no iPhone instalado o topo e a barra ganham a área do relógio e do gesto de início — a conta fixa deixava o campo de
  // escrever atrás da barra)
  const area = useAreaVisivel();

  return (
    <div className="fixed inset-x-0 z-20 mx-auto flex max-w-2xl flex-col bg-surface-page" data-vista="chat" data-chat-conversa data-teclado={area.teclado || undefined}
      style={{ top: `calc(var(--tec-topo, 0px) + ${area.deslocamento}px)`, height: `calc(${area.altura}px - var(--tec-topo, 0px) - var(--tec-barra, 0px))` }}>
      <header className="flex items-center gap-2.5 border-b border-surface-border bg-white px-3 py-2">
        <span className="shrink-0 w-10 h-10 rounded-full bg-primary-50 text-primary-700 inline-flex items-center justify-center" aria-hidden>
          <Building2 className="w-5 h-5" />
        </span>
        <h1 className="flex-1 min-w-0 text-lg font-bold text-ink inline-flex items-center gap-1.5" data-chat-titulo>
          Escritório
          <Dica rotulo="Escritório" texto="Conversa com o escritório: qualquer pessoa do escritório lê e responde, e o balão mostra quem respondeu. Cada mensagem leva a OS escolhida acima do campo de texto (ou Sem OS). A conversa é interna: o cliente não vê. Sem sinal, a mensagem fica no aparelho e sobe sozinha quando o sinal voltar." />
        </h1>
        <button type="button" onClick={() => void carregar()} disabled={atualizando} aria-label="Atualizar a conversa" title="Atualizar" data-atualizar-chat
          className="shrink-0 rounded-full w-11 h-11 inline-flex items-center justify-center text-ink-muted hover:bg-surface-alt disabled:opacity-50 touch-target">
          <RefreshCw className={cn("w-4 h-4", atualizando && "animate-spin")} aria-hidden />
        </button>
      </header>
      {carga?.doAparelho && (
        <div className="px-3 pt-2 bg-surface-page">
          <AvisoGuardado texto={carga.dados
            ? `Sem sinal: conversa da última sincronização${carga.baixadoEm ? ` (às ${horaBR(carga.baixadoEm)})` : ""}.`
            : semSinal ? MSG_CONVERSA_SEM_SINAL : "Não foi possível carregar a conversa. Toque em Atualizar para tentar de novo."} />
        </div>
      )}
      <ConversaChat className="flex-1" mensagens={mensagens} carregando={!carga} mostrarOs abrirOs={abrirOs} podeAbrirOs={(osId) => !!atividadeDaOs(osId, osDoDia, atividades)}
        onEnviar={enviar} urlFoto={urlFotoApp} onTentarDeNovo={() => { void motor?.tentarDeNovo(); }} placeholder="Escreva para o escritório"
        onCitar={aoCitar} carregarAte={carregarAte}
        origem="APP" osDaMensagem={osEscolhida} equipamentosDaOs={(id) => equipamentos[id]} lerQr={(f) => lerQrDaFoto(f)} resolverQr={resolverQr}
        onCorrigirEquipamento={corrigirEquipamento}
        recusa={{ opcoesOs: osDoDia, reenviar: (m, osId) => { void reenviar(m, osId); }, descartar: (m) => { void descartar(m); } }}
        acimaDoTexto={<SeletorOs opcoes={opcoes} valor={osEscolhida} onValor={(id) => setEscolha(id)} />} />
    </div>
  );
}
