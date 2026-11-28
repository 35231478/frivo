"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCheck, Clock, FileText, Reply, RotateCcw, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaBR } from "@/lib/fuso";
import { Citacao } from "@/components/chat/citacao";
import { EscolhaEquipamento } from "@/components/chat/escolha-equipamento";
import { MOTIVO_EQUIPAMENTO, ROTULO_SEM_EQUIPAMENTO, type EquipamentoFotoTela } from "@/lib/chat/equipamento-foto";
import { ARRASTE_RESPONDER_PX, estadoDaMensagem, podeResponder, ROTULO_ESTADO, TOQUE_LONGO_MS } from "@/lib/chat/regras";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

const ITEM_MENU = "flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-surface-alt touch-target";

/** O "porquê" do estado, na dica do ✓ (quem leu e quando) */
function dicaEstado(m: ComentarioTela): string {
  const e = estadoDaMensagem(m);
  if (e === "lida" && m.lida) return `Lida por ${m.lida.por} às ${horaBR(m.lida.em)}`;
  if (e === "falhou") return m.falhou ?? ROTULO_ESTADO.falhou;
  if (e === "enviando") return "Enviando… (no aparelho, sobe quando houver sinal)";
  return "Enviada (ainda não lida)";
}

/**
 * UM balão da conversa (escritório e app): à direita o que é meu, à esquerda o dos outros (com o nome e de onde
 * escreveu). Foto: a miniatura, que amplia no toque. Na minha mensagem, a hora e o estado: relógio (enviando), ✓
 * (enviada), ✓✓ (lida — quem e quando na dica) ou "Não enviada" com "Tentar de novo".
 *
 * Responder (como no WhatsApp): no computador, o ícone ao passar o mouse e o menu do botão direito; no celular, arrastar
 * o balão para a direita ou o toque longo (o mesmo menu). A citação no topo do balão leva até a original.
 */
export function Balao({ m, mostrarAutor, onAmpliar, onTentarDeNovo, onResponder, onIrParaCitada, destacada, equipamentos, onCorrigirEquipamento, onRelatorio }: {
  m: ComentarioTela;
  /** O nome em cima (1ª de uma sequência do mesmo autor) */
  mostrarAutor: boolean;
  onAmpliar?: (m: ComentarioTela) => void;
  onTentarDeNovo?: (m: ComentarioTela) => void;
  /** Responder esta mensagem (sem isso, a conversa é só leitura: nada de responder) */
  onResponder?: (m: ComentarioTela) => void;
  /** Tocar na citação: ir até a original */
  onIrParaCitada?: (m: ComentarioTela) => void;
  /** A original que a citação acabou de chamar: destacada por um instante */
  destacada?: boolean;
  /** CHAT-1.1: os equipamentos da OS da mensagem (corrigir o da foto) */
  equipamentos?: EquipamentoFotoTela[];
  /** Corrigir (ou tirar) o equipamento da foto; devolve o erro, ou null */
  onCorrigirEquipamento?: (m: ComentarioTela, equipamentoId: string | null) => Promise<string | null>;
  /** Escritório: pôr ou tirar a foto do relatório da atividade */
  onRelatorio?: (m: ComentarioTela, noRelatorio: boolean) => Promise<string | null>;
}) {
  const estado = m.meu ? estadoDaMensagem(m) : null;
  const IconeEstado = estado === "lida" ? CheckCheck : estado === "enviada" ? Check : estado === "enviando" ? Clock : AlertCircle;
  const [menu, setMenu] = useState(false);
  const [arraste, setArraste] = useState(0);
  const toque = useRef<{ x: number; y: number; dx: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  // O toque longo abriu o menu: o "clique" que vem ao soltar não abre a foto
  const engolirClique = useRef(false);
  const raiz = useRef<HTMLLIElement>(null);
  const responder = onResponder && podeResponder(m) ? () => { setMenu(false); onResponder(m); } : undefined;
  // CHAT-1.1: a foto com OS pode ter o equipamento corrigido e, no escritório, ir para o relatório
  const [escolhendo, setEscolhendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const fotoComOs = !!m.foto && !!m.os && !m.falhou && !!(m.id || m.clientId);
  const corrigir = fotoComOs && onCorrigirEquipamento && !!equipamentos ? () => { setMenu(false); setAviso(null); setEscolhendo((v) => !v); } : undefined;
  const relatorio = fotoComOs && onRelatorio && !!m.id ? async () => { setMenu(false); setAviso(await onRelatorio(m, !m.foto?.noRelatorio)); } : undefined;
  const temAcoes = !!(responder || corrigir || relatorio);

  // O menu fecha ao tocar fora ou com Esc
  useEffect(() => {
    if (!menu) return;
    const fora = (e: Event) => { if (!raiz.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [menu]);
  useEffect(() => () => { if (toque.current) clearTimeout(toque.current.timer); }, []);

  // Celular: arrastar para a direita responde; segurar abre o menu. O mouse usa o ícone e o botão direito.
  function aoApertar(e: React.PointerEvent) {
    if (!temAcoes || e.pointerType === "mouse") return;
    toque.current = { x: e.clientX, y: e.clientY, dx: 0, timer: setTimeout(() => { engolirClique.current = true; setMenu(true); }, TOQUE_LONGO_MS) };
  }
  function aoMover(e: React.PointerEvent) {
    const t = toque.current;
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(t.timer);
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) { soltar(false); return; } // é a conversa rolando
    t.dx = Math.max(0, Math.min(dx, ARRASTE_RESPONDER_PX + 16));
    setArraste(t.dx);
  }
  function soltar(vale = true) {
    const t = toque.current;
    toque.current = null;
    setArraste(0);
    if (!t) return;
    clearTimeout(t.timer);
    if (vale && t.dx >= ARRASTE_RESPONDER_PX) responder?.();
  }

  return (
    <li ref={raiz} className={cn("flex", m.meu ? "justify-end" : "justify-start")} data-mensagem={m.clientId ?? m.id ?? undefined} data-mensagem-id={m.id ?? undefined}
      data-minha={m.meu || undefined} data-origem={m.origem} data-estado={estado ?? undefined} data-nova={m.novo || undefined} data-destacada={destacada || undefined}>
      <div className={cn("relative group flex items-center gap-1 max-w-[85%] sm:max-w-[70%]", m.meu && "flex-row-reverse")}>
      {arraste > 0 && (
        <span className="absolute -left-7 top-1/2 -translate-y-1/2 text-primary-600" style={{ opacity: Math.min(1, arraste / ARRASTE_RESPONDER_PX) }} aria-hidden data-arraste-responder>
          <Reply className="w-5 h-5" />
        </span>
      )}
      <div onPointerDown={aoApertar} onPointerMove={aoMover} onPointerUp={() => soltar()} onPointerCancel={() => soltar(false)}
        onContextMenu={(e) => { if (!temAcoes) return; e.preventDefault(); setMenu(true); }}
        onClickCapture={(e) => { if (engolirClique.current) { engolirClique.current = false; e.preventDefault(); e.stopPropagation(); } }}
        style={arraste ? { transform: `translateX(${arraste}px)` } : undefined}
        className={cn("min-w-0 rounded-2xl px-3 py-2 shadow-sm space-y-1 touch-pan-y transition-[box-shadow,background-color] duration-300",
        temAcoes && "[-webkit-touch-callout:none] [@media(hover:none)]:select-none",
        m.meu ? "bg-primary-50 border border-primary-200 rounded-br-md" : "bg-white border border-surface-border rounded-bl-md",
        m.novo && "ring-2 ring-acento/40", estado === "falhou" && "border-atrasado/40", destacada && "ring-2 ring-acento bg-acento/10")} data-corpo-balao>
        {m.respostaA && <Citacao c={m.respostaA} onIr={onIrParaCitada ? () => onIrParaCitada(m) : undefined} />}
        {mostrarAutor && !m.meu && (
          <p className="text-xs font-semibold text-primary-700" data-autor>
            {m.autor}<span className="font-normal text-ink-muted">{m.origem === "ESCRITORIO" ? " · escritório" : m.atividade ? ` · ${m.atividade}` : " · app"}</span>
          </p>
        )}
        {m.foto && (
          <button type="button" onClick={() => onAmpliar?.(m)} disabled={!onAmpliar || !m.foto.id} aria-label="Ampliar a foto" data-foto-mensagem
            className="block overflow-hidden rounded-lg bg-surface-alt disabled:cursor-default">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.foto.miniatura} alt="Foto da mensagem" className="max-h-60 w-auto max-w-full object-cover" loading="lazy" />
          </button>
        )}
        {fotoComOs && (m.foto!.equipamento || m.foto!.sugerido || m.foto!.noRelatorio || (equipamentos?.length ?? 0) > 1) && (
          <p className="flex flex-wrap items-center gap-1 text-[11px]" data-foto-equipamento-area>
            {(m.foto!.equipamento || (equipamentos?.length ?? 0) > 1) && (
              <button type="button" onClick={corrigir} disabled={!corrigir} data-equipamento-foto={m.foto!.equipamento?.id ?? ""}
                title={m.foto!.equipamento ? `${m.foto!.origemEquipamento ? MOTIVO_EQUIPAMENTO[m.foto!.origemEquipamento] : ""}${corrigir ? " Toque para corrigir." : ""}`.trim() : corrigir ? "Toque para vincular a um equipamento da OS." : undefined}
                className={cn("inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-0.5 max-w-full truncate disabled:cursor-default", m.foto!.equipamento ? "text-ink-muted" : "text-ink-subtle", corrigir && "hover:text-primary-700")}>
                <Thermometer className="w-3 h-3 shrink-0" aria-hidden />{m.foto!.equipamento?.titulo ?? ROTULO_SEM_EQUIPAMENTO}
              </button>
            )}
            {m.foto!.sugerido && (
              <span className="text-atencao-texto" title="O QR code na foto é de um equipamento de outro cliente: a foto não foi vinculada a ele." data-sugerido={m.foto!.sugerido.id}>
                QR de outro cliente: {m.foto!.sugerido.titulo}
              </span>
            )}
            {m.foto!.noRelatorio && (
              <span className="inline-flex items-center gap-1 text-primary-700" title="O escritório pôs esta foto no relatório da atividade." data-no-relatorio>
                <FileText className="w-3 h-3" aria-hidden />No relatório
              </span>
            )}
          </p>
        )}
        {escolhendo && corrigir && equipamentos && (
          <EscolhaEquipamento opcoes={equipamentos} valor={m.foto?.equipamento?.id ?? null}
            onValor={async (id) => { const e = await onCorrigirEquipamento!(m, id); setAviso(e); if (!e) setEscolhendo(false); }} />
        )}
        {aviso && <p className="text-xs text-atrasado" role="alert" data-aviso-balao>{aviso}</p>}
        {m.texto && <p className="text-sm sm:text-[15px] text-ink whitespace-pre-line break-words">{m.texto}</p>}
        <p className={cn("flex items-center justify-end gap-1 text-[11px]", estado === "falhou" ? "text-atrasado" : "text-ink-subtle")}>
          {estado === "falhou"
            ? <span data-falhou>{ROTULO_ESTADO.falhou}</span>
            : <span>{m.para && <span className="mr-1" data-para>para {m.para.split(" ")[0]} ·</span>}{m.pendente ? "" : horaBR(m.criadoEm)}</span>}
          {estado && (
            <span title={dicaEstado(m)} aria-label={dicaEstado(m)} data-estado-icone={estado}
              className={cn("inline-flex", estado === "lida" && "text-primary-600")}>
              <IconeEstado className="w-3.5 h-3.5" aria-hidden />
            </span>
          )}
        </p>
        {estado === "falhou" && onTentarDeNovo && (
          <button type="button" onClick={() => onTentarDeNovo(m)} data-tentar-de-novo
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 touch-target">
            <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Tentar de novo
          </button>
        )}
      </div>
      {/* Computador: o ícone Responder aparece ao passar o mouse (no celular, o arraste e o toque longo) */}
      {responder && (
        <button type="button" onClick={responder} aria-label="Responder" title="Responder" data-responder
          className="shrink-0 hidden [@media(hover:hover)]:inline-flex w-8 h-8 items-center justify-center rounded-full text-ink-subtle hover:text-primary-700 hover:bg-surface-alt opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
          <Reply className="w-4 h-4" aria-hidden />
        </button>
      )}
      {menu && temAcoes && (
        <div role="menu" aria-label="Ações da mensagem" data-menu-mensagem
          className={cn("absolute z-20 top-full mt-1 min-w-44 rounded-lg border border-surface-border bg-white py-1 shadow-lg", m.meu ? "right-0" : "left-0")}>
          {responder && (
            <button type="button" role="menuitem" onClick={responder} autoFocus data-menu-responder className={ITEM_MENU}>
              <Reply className="w-4 h-4 text-ink-muted" aria-hidden /> Responder
            </button>
          )}
          {corrigir && (
            <button type="button" role="menuitem" onClick={corrigir} autoFocus={!responder} data-menu-equipamento className={ITEM_MENU}>
              <Thermometer className="w-4 h-4 text-ink-muted" aria-hidden /> Equipamento da foto
            </button>
          )}
          {relatorio && (
            <button type="button" role="menuitem" onClick={() => void relatorio()} data-menu-relatorio className={ITEM_MENU}>
              <FileText className="w-4 h-4 text-ink-muted" aria-hidden /> {m.foto?.noRelatorio ? "Tirar do relatório" : "Mostrar no relatório"}
            </button>
          )}
        </div>
      )}
      </div>
    </li>
  );
}
