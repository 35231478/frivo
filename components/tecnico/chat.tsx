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
import { juntarComFila } from "@/lib/chat/regras";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { MSG_SEM_ESPACO } from "@/lib/tecnico/offline/armazenamento";
import { comentarioSchema, type ComentarioTela } from "@/lib/tecnico/comentarios";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";
import {
  atividadeDaOs, atividadeDoEnvio, CHAVE_CONVERSA, confirmadasForaDaConversa, conversaValida, dicaNaoLidas, mapaDeAtividades, mensagensDaFila,
  mensagensSumidas, MSG_CONVERSA_SEM_SINAL, osDoSeletor, precisaRecarregar, rotuloNaoLidas, semCliente, URL_CONVERSA_APP, urlFotoApp,
  type RespostaConversa,
} from "@/lib/tecnico/chat";

type Carga = { dados: RespostaConversa | null; baixadoEm: number | null; doAparelho: boolean };
type AtividadeGuardada = { atividadeId: string; osId: string; osNumero: string; cliente: string };

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
  // A OS que o técnico escolheu no seletor (undefined = ainda não escolheu: vale a OS padrão do servidor)
  const [escolha, setEscolha] = useState<string | null | undefined>(undefined);
  // A que saiu da fila (o servidor confirmou) segue "Enviando…" até a conversa trazê-la com o ✓;
  // `pedido` = o 1º pedido da conversa feito depois de ela sair da fila (o que a traz)
  const [sumidas, setSumidas] = useState<{ m: ComentarioTela; pedido: number }[]>([]);
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    if (!motor) return;
    const n = ++pedido.current;
    setAtualizando(true);
    let x: Carga;
    try { x = await motor.baixarLista<RespostaConversa>(CHAVE_CONVERSA, URL_CONVERSA_APP); } catch { x = { dados: null, baixadoEm: null, doAparelho: true }; }
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
      if (vivo) setGuardadas(rs.map(({ retrato: { cartao: c } }) => ({ atividadeId: c.atividadeId, osId: c.osId, osNumero: c.osNumero, cliente: c.cliente })));
    }, () => { /* idem */ });
    return () => { vivo = false; };
  }, [motor, estado.versao]);

  const dados = useMemo(() => (carga?.dados ? semCliente(carga.dados, config.exibirDadosCliente) : null), [carga, config.exibirDadosCliente]);
  const osDoDia = useMemo(() => dados?.osDoDia ?? [], [dados]);
  const atividades = useMemo(() => mapaDeAtividades(osDoDia, config.exibirDadosCliente ? guardadas : guardadas.map((g) => ({ ...g, cliente: "" }))),
    [osDoDia, guardadas, config.exibirDadosCliente]);
  const servidor = useMemo(() => dados?.mensagens ?? [], [dados]);
  const daFila = useMemo(() => mensagensDaFila(fila, atividades, usuario.nome), [fila, atividades, usuario.nome]);

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
    return juntarComFila(servidor, [...daFila, ...sumidas.map((s) => s.m).filter((m) => !ids.has(m.clientId))]);
  }, [servidor, daFila, sumidas]);

  const osEscolhida = osDoSeletor(escolha, dados?.osPadrao, osDoDia);

  async function enviar(d: EnvioMensagem): Promise<string | null> {
    if (!motor) return MSG_SEM_ESPACO;
    const v = comentarioSchema.safeParse({ clientId: novoClientId(), texto: d.texto, ...(d.foto && d.miniatura && { foto: d.foto, miniatura: d.miniatura }) });
    if (!v.success) return v.error.issues[0]?.message ?? MSG_SEM_ESPACO;
    try {
      await motor.registrar([{ tipo: "comentario", atividadeId: atividadeDoEnvio(osEscolhida, osDoDia), dados: v.data }]);
    } catch {
      return MSG_SEM_ESPACO; // o aparelho não guardou: nunca finge que enviou
    }
    setEscolha(osEscolhida); // a próxima vai na mesma OS (ou sem OS)
    setFila(await motor.banco.fila());
    return null;
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
        acimaDoTexto={<SeletorOs opcoes={osDoDia} valor={osEscolhida} onValor={(id) => setEscolha(id)} />} />
    </div>
  );
}
