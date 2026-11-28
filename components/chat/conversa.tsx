"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaBR } from "@/lib/fuso";
import { Balao } from "@/components/chat/balao";
import { Citacao } from "@/components/chat/citacao";
import { EscolhaEquipamento } from "@/components/chat/escolha-equipamento";
import { MOTIVO_EQUIPAMENTO, vinculoDaFoto, type EquipamentoFotoTela } from "@/lib/chat/equipamento-foto";
import { Lightbox, type ItemLightbox } from "@/components/ui/lightbox";
import {
  acharCitada, citacaoDe, DESTAQUE_MS, mostraAutor, mostraEtiquetaOs, MSG_CITADA_NAO_ENCONTRADA, preencherCitacoes, refDaCitada, rotuloDoDia, ROTULO_SEM_OS,
  TEXTO_MAX,
} from "@/lib/chat/regras";
import { prepararFoto } from "@/lib/chat/foto-cliente";
import type { ComentarioTela, RefCitacao } from "@/lib/tecnico/comentarios";

/** O que a caixa de escrever envia; `respostaA` = a mensagem respondida (pelo id, ou pelo clientId se ainda "Enviando…") */
export interface EnvioMensagem {
  texto: string; foto?: string; miniatura?: string; respostaA?: RefCitacao;
  /** CHAT-1.1: o equipamento da foto escolhido (null = "Sem equipamento") e o QR code lido nela, no aparelho */
  equipamentoId?: string | null; qr?: string;
}

/** Os equipamentos de uma OS para a foto: a lista e, no app, o da atividade em andamento do técnico */
export type InfoEquipamentos = { equipamentos: EquipamentoFotoTela[]; emAndamento: string | null };
/** O QR lido na foto, resolvido no aparelho (o servidor confere de novo) */
export type QrResolvido = { equipamentoId: string; mesmoCliente: boolean; titulo: string };

const chave = (m: Pick<ComentarioTela, "clientId" | "id">) => m.clientId ?? m.id ?? "";

/**
 * A CONVERSA de uma OS — a mesma no escritório (tela Conversas e dentro da OS) e no app do técnico: os balões com o
 * separador de dia, a foto que amplia e a caixa de escrever (texto, foto da câmera ou da galeria, Enter envia no
 * computador). Quem envia de fato é a tela (`onEnviar`): o escritório pela rota; o app pela fila do aparelho.
 */
export function ConversaChat({
  mensagens, carregando, erro, somenteLeitura, podeEscrever = true, semPermissao, onEnviar, urlFoto, onTentarDeNovo, className, placeholder = "Mensagem",
  mostrarOs = false, abrirOs, podeAbrirOs, acimaDoTexto, onCitar, carregarAte,
  origem = "ESCRITORIO", osDaMensagem, equipamentosDaOs, lerQr, resolverQr, onCorrigirEquipamento, onRelatorio, recusa,
}: {
  /** App: o que fazer com a mensagem que a fila recusou de vez (ver Balao) */
  recusa?: React.ComponentProps<typeof Balao>["recusa"];
  /** CHAT-1.1: quem escreve (o app usa a atividade em andamento e o QR; o escritório, só "um equipamento" e a escolha) */
  origem?: "APP" | "ESCRITORIO";
  /** A OS da próxima mensagem (a foto se vincula a um equipamento dela) */
  osDaMensagem?: string | null;
  equipamentosDaOs?: (osId: string) => InfoEquipamentos | undefined;
  /** App: lê o QR code Frivo na foto escolhida (o leitor que o app já usa) */
  lerQr?: (arquivo: Blob) => Promise<string | null>;
  resolverQr?: (valor: string) => QrResolvido | null;
  onCorrigirEquipamento?: (m: ComentarioTela, equipamentoId: string | null) => Promise<string | null>;
  onRelatorio?: (m: ComentarioTela, noRelatorio: boolean) => Promise<string | null>;
  /** Começou a responder (a tela herda a OS da citada) ou cancelou (null) */
  onCitar?: (m: ComentarioTela | null) => void;
  /** A citada não está entre as carregadas: a tela carrega a conversa desde ela (pelo id) */
  carregarAte?: (id: string) => Promise<void>;
  /** Esta etiqueta abre a OS? (app: só a OS em que o técnico tem atividade); sem isso, todas abrem quando há abrirOs */
  podeAbrirOs?: (osId: string) => boolean;
  /** Conversa da PESSOA: a etiqueta da OS (nº + cliente, abre a OS) quando a OS muda; seguidas da mesma OS agrupam */
  mostrarOs?: boolean;
  abrirOs?: (osId: string) => void;
  /** O seletor de OS (1 toque) acima do campo de texto */
  acimaDoTexto?: React.ReactNode;
  mensagens: ComentarioTela[];
  carregando?: boolean;
  erro?: string | null;
  /** Motivo de a conversa ser só leitura (OS cancelada) */
  somenteLeitura?: string | null;
  /** Tem a permissão de escrever (escritório: editar OS) */
  podeEscrever?: boolean;
  semPermissao?: string;
  /** Envia; devolve a mensagem de erro (ou null quando deu certo). `citada`: a mensagem respondida (a citação na hora) */
  onEnviar: (d: EnvioMensagem, citada?: ComentarioTela) => Promise<string | null>;
  /** O endereço da foto inteira (ampliar) */
  urlFoto: (fotoId: string) => string;
  onTentarDeNovo?: (m: ComentarioTela) => void;
  className?: string;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState("");
  const [foto, setFoto] = useState<{ foto: string; miniatura: string } | null>(null);
  // CHAT-1.1: a escolha do equipamento da foto (undefined = não escolheu: valem as regras) e o QR lido nela
  const [equipEscolha, setEquipEscolha] = useState<string | null | undefined>(undefined);
  const [qr, setQr] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ampliar, setAmpliar] = useState<number | null>(null);
  const [citando, setCitando] = useState<ComentarioTela | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  // Indo até uma citada que não estava carregada: `buscou` = a tela já carregou desde ela
  const [indo, setIndo] = useState<{ c: NonNullable<ComentarioTela["respostaA"]>; buscou: boolean } | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  // Está no fim da conversa? Se a área encolher (o teclado abriu), continua no fim — a última mensagem à vista
  const noFim = useRef(true);
  const irProFim = () => { const el = lista.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => {
    const el = lista.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => { if (noFim.current) irProFim(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const arquivo = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  // A fila do aparelho guarda só a referência da citada: a citação vem da própria conversa
  mensagens = useMemo(() => preencherCitacoes(mensagens), [mensagens]);

  // Rola para o fim quando chega mensagem (e na 1ª vez)
  const ultima = mensagens.at(-1)?.clientId ?? mensagens.at(-1)?.id ?? null;
  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ultima, mensagens.length]);

  const fotos = useMemo(() => mensagens.filter((m) => m.foto?.id), [mensagens]);
  const itensLightbox: ItemLightbox[] = fotos.map((m) => ({
    src: urlFoto(m.foto!.id!), baixar: urlFoto(m.foto!.id!), nomeArquivo: `foto-${m.foto!.id}.jpg`,
    titulo: m.texto || "Foto da conversa", detalhes: [`${m.meu ? "Enviada" : m.autor} às ${horaBR(m.criadoEm)}`],
  }));

  async function escolherFoto(f: File | undefined) {
    if (!f) return;
    setPreparando(true); setAviso(null);
    const r = await prepararFoto(f);
    setPreparando(false);
    if (arquivo.current) arquivo.current.value = "";
    if (!r.ok) { setAviso(r.erro); return; }
    setFoto({ foto: r.foto, miniatura: r.miniatura });
    setEquipEscolha(undefined);
    setQr(lerQr ? await lerQr(f).catch(() => null) : null);
  }
  function tirarFoto() { setFoto(null); setEquipEscolha(undefined); setQr(null); }

  // A prévia do equipamento da foto: as mesmas regras do servidor, com o que o aparelho sabe (o servidor decide)
  const infoEquip = foto && osDaMensagem ? equipamentosDaOs?.(osDaMensagem) : undefined;
  const qrResolvido = qr ? resolverQr?.(qr) ?? null : null;
  const previa = infoEquip ? vinculoDaFoto({
    origem, temOs: true, equipamentosDaOs: infoEquip.equipamentos.map((e) => e.id), emAndamento: infoEquip.emAndamento,
    qr: qrResolvido, escolha: equipEscolha,
  }) : null;
  const opcoesEquip = infoEquip
    ? (qrResolvido?.mesmoCliente && !infoEquip.equipamentos.some((e) => e.id === qrResolvido.equipamentoId)
      ? [...infoEquip.equipamentos, { id: qrResolvido.equipamentoId, titulo: qrResolvido.titulo }] : infoEquip.equipamentos)
    : [];

  async function enviar() {
    const t = texto.trim();
    if ((!t && !foto) || enviando) return;
    setEnviando(true); setAviso(null);
    const ref = citando ? refDaCitada(citando) : null;
    const e = await onEnviar({
      texto: t, ...(foto ?? {}), ...(ref && { respostaA: ref }),
      ...(foto && equipEscolha !== undefined && { equipamentoId: equipEscolha }), ...(foto && qr && { qr }),
    }, citando ?? undefined);
    setEnviando(false);
    if (e) { setAviso(e); return; }
    setTexto(""); tirarFoto(); setCitando(null);
  }

  function responder(m: ComentarioTela) {
    setCitando(m); setAviso(null);
    onCitar?.(m);
    campo.current?.focus();
  }
  function cancelarCitacao() {
    setCitando(null);
    onCitar?.(null);
  }

  // Ir até a original: rola até ela e a destaca por um instante; fora do que foi carregado, a tela carrega desde ela
  function irPara(m: ComentarioTela) {
    const c = m.respostaA;
    if (!c || c.indisponivel) return;
    if (mostrar(c)) return;
    if (carregarAte && c.id) { setIndo({ c, buscou: false }); void carregarAte(c.id).finally(() => setIndo((x) => (x && x.c === c ? { ...x, buscou: true } : x))); }
    else setAviso(MSG_CITADA_NAO_ENCONTRADA);
  }
  function mostrar(c: NonNullable<ComentarioTela["respostaA"]>): boolean {
    const alvo = acharCitada(mensagens, c);
    if (!alvo) return false;
    const k = chave(alvo);
    const el = [...(lista.current?.querySelectorAll<HTMLElement>("[data-mensagem]") ?? [])].find((x) => x.dataset.mensagem === k);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setDestaque(k);
    return true;
  }
  useEffect(() => {
    if (!indo) return;
    if (mostrar(indo.c)) { setIndo(null); return; }
    if (indo.buscou) { setIndo(null); setAviso(MSG_CITADA_NAO_ENCONTRADA); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indo, mensagens]);
  useEffect(() => {
    if (!destaque) return;
    const t = setTimeout(() => setDestaque(null), DESTAQUE_MS);
    return () => clearTimeout(t);
  }, [destaque]);

  const bloqueio = somenteLeitura ?? (!podeEscrever ? semPermissao ?? "Sem permissão para escrever nesta conversa." : null);
  // Responder só onde se escreve (OS cancelada ou sem permissão: só leitura)
  const aoResponder = bloqueio ? undefined : responder;

  return (
    <div className={cn("flex flex-col min-h-0", className)} data-conversa>
      <div ref={lista} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pt-3 pb-4 bg-surface-page" data-mensagens
        onScroll={(e) => { const el = e.currentTarget; noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {carregando && !mensagens.length ? (
          <p className="flex justify-center py-8 text-ink-muted"><Loader2 className="w-5 h-5 animate-spin" aria-label="Carregando" /></p>
        ) : erro ? (
          <p className="text-sm text-atrasado text-center py-8" role="alert">{erro}</p>
        ) : !mensagens.length ? (
          <p className="text-sm text-ink-muted text-center py-8" data-sem-mensagens>Nenhuma mensagem ainda. A conversa é interna: o cliente não vê.</p>
        ) : (
          <ul className="space-y-1.5">
            {mensagens.map((m, i) => {
              const ant = mensagens[i - 1];
              const dia = rotuloDoDia(m.criadoEm);
              const novoDia = !ant || rotuloDoDia(ant.criadoEm) !== dia;
              const mostrarAutor = mostraAutor(m, ant, { comEtiquetaOs: mostrarOs });
              return (
                <Fragment key={m.clientId ?? m.id ?? i}>
                  {novoDia && (
                    <li className="flex justify-center py-1" data-dia>
                      <span className="text-[11px] font-semibold text-ink-muted bg-white border border-surface-border rounded-full px-2.5 py-0.5">{dia}</span>
                    </li>
                  )}
                  {mostrarOs && mostraEtiquetaOs(m, ant) && (
                    <li className="flex items-center gap-2 pt-2 pb-0.5" data-etiqueta-os={m.os?.id ?? "sem-os"}>
                      <span className="h-px flex-1 bg-surface-border" aria-hidden />
                      {m.os ? (
                        <button type="button" onClick={() => abrirOs?.(m.os!.id)} disabled={!abrirOs || (podeAbrirOs ? !podeAbrirOs(m.os.id) : false)} title="Abrir a OS"
                          className="text-[11px] font-semibold text-primary-700 hover:underline disabled:no-underline disabled:cursor-default truncate max-w-[80%]">
                          {m.os.numero}{m.os.cliente ? ` · ${m.os.cliente}` : ""}
                        </button>
                      ) : <span className="text-[11px] font-semibold text-ink-subtle">{ROTULO_SEM_OS}</span>}
                      <span className="h-px flex-1 bg-surface-border" aria-hidden />
                    </li>
                  )}
                  <Balao m={m} mostrarAutor={mostrarAutor} onTentarDeNovo={onTentarDeNovo} recusa={recusa} onResponder={aoResponder} onIrParaCitada={irPara}
                    destacada={!!destaque && destaque === chave(m)}
                    equipamentos={m.os ? equipamentosDaOs?.(m.os.id)?.equipamentos : undefined}
                    onCorrigirEquipamento={bloqueio ? undefined : onCorrigirEquipamento} onRelatorio={bloqueio ? undefined : onRelatorio}
                    onAmpliar={(x) => { const k = fotos.findIndex((f) => f.foto?.id === x.foto?.id); if (k >= 0) setAmpliar(k); }} />
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>

      {bloqueio ? (
        <p className="border-t border-surface-border bg-white px-4 py-3 text-sm text-ink-muted text-center" data-somente-leitura>{bloqueio}</p>
      ) : (
        <div className="border-t border-surface-border bg-white p-2 space-y-2" data-escrever>
          {acimaDoTexto}
          {aviso && <p className="text-xs text-atrasado px-1" role="alert" data-aviso-chat>{aviso}</p>}
          {citando && (
            <div className="flex items-center gap-2" data-citando>
              <Citacao c={citacaoDe(citando)} className="flex-1" />
              <button type="button" onClick={cancelarCitacao} aria-label="Cancelar a resposta" title="Cancelar a resposta" data-cancelar-citacao
                className="shrink-0 rounded-full w-9 h-9 inline-flex items-center justify-center text-ink-muted hover:bg-surface-alt touch-target">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {foto && (
            <div className="relative inline-block" data-foto-escolhida>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto.miniatura} alt="Foto escolhida" className="h-20 w-auto rounded-lg border border-surface-border" />
              <button type="button" onClick={tirarFoto} aria-label="Tirar a foto"
                className="absolute -top-2 -right-2 rounded-full bg-ink text-white w-6 h-6 inline-flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {foto && previa && opcoesEquip.length > 0 && (
            <div className="space-y-1" data-equipamento-da-foto>
              <p className="text-[11px] text-ink-muted px-1" data-motivo-equipamento>
                {previa.origem && previa.origem !== "ESCOLHA" ? MOTIVO_EQUIPAMENTO[previa.origem]
                  : previa.precisaEscolher && equipEscolha === undefined ? "A OS tem vários equipamentos: escolha o da foto (ou deixe sem)." : "Equipamento da foto:"}
                {qr && !qrResolvido && " QR code lido na foto: o servidor confere."}
                {qrResolvido && !qrResolvido.mesmoCliente && ` O QR code na foto é de outro cliente (${qrResolvido.titulo}): não será vinculada.`}
              </p>
              <EscolhaEquipamento opcoes={opcoesEquip} valor={previa.equipamentoId ?? (equipEscolha === null ? null : undefined)} onValor={setEquipEscolha} />
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={arquivo} type="file" accept="image/*" className="hidden" onChange={(e) => void escolherFoto(e.target.files?.[0])} data-input-foto />
            <button type="button" onClick={() => arquivo.current?.click()} disabled={preparando || enviando} aria-label="Enviar foto (câmera ou galeria)" title="Foto (câmera ou galeria)"
              className="shrink-0 rounded-full w-11 h-11 inline-flex items-center justify-center text-ink-muted hover:text-primary-700 hover:bg-surface-alt disabled:opacity-40 touch-target" data-anexar-foto>
              {preparando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            </button>
            <textarea ref={campo} value={texto} onFocus={() => { noFim.current = true; setTimeout(irProFim, 350); }} onChange={(e) => setTexto(e.target.value)} maxLength={TEXTO_MAX} rows={1} placeholder={placeholder} aria-label="Mensagem"
              onKeyDown={(e) => {
                if (e.key === "Escape" && citando) { e.preventDefault(); cancelarCitacao(); return; }
                if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); void enviar(); }
              }}
              className="flex-1 min-w-0 max-h-32 rounded-2xl border border-surface-border px-3.5 py-2.5 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-primary-500/40" data-texto-mensagem />
            <button type="button" onClick={() => void enviar()} disabled={(!texto.trim() && !foto) || enviando} aria-label="Enviar mensagem"
              className="shrink-0 rounded-full bg-primary-600 text-white w-11 h-11 inline-flex items-center justify-center disabled:opacity-40 touch-target" data-enviar-mensagem>
              {enviando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}
      {ampliar !== null && itensLightbox[ampliar] && <Lightbox itens={itensLightbox} indice={ampliar} onIndice={setAmpliar} onFechar={() => setAmpliar(null)} />}
    </div>
  );
}
