"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, Loader2, MessageSquarePlus, Pin, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import { ancorarElemento, pontoDoPin, reencontrar } from "@/lib/anotacoes/ancora";
import { ROTULO_PRECISAO, TEXTO_MAX, telaDaRota, type Ancora, type Precisao } from "@/lib/anotacoes/regras";
import { chavePosicaoBotao, ehArraste, lerPosicao, limitarPosicao, posicaoArrastada, posicaoDoVoltar, type Ponto } from "@/lib/anotacoes/posicao-botao";

/**
 * ANOTAÇÕES INTERNAS — a ferramenta na tela. Só o dono do Frivo chega aqui (o layout do painel só
 * monta a casca para ele, e o chunk desta ferramenta só baixa depois disso).
 *
 * COMO FUNCIONA: um botão discreto (ou Alt+A) liga o MODO. No modo, um véu por cima da tela
 * captura o clique: clicou num elemento, nasce a âncora (lib/anotacoes/ancora.ts), o print é
 * tirado e o balão abre para escrever. Salvou, o pin fica ancorado ali.
 *
 * FORA DO MODO NÃO HÁ INTERFERÊNCIA NENHUMA: nenhum véu, nenhum pin, nenhum elemento por cima da
 * tela. O único ouvinte que fica é o do atalho de teclado — ele lê Alt+A e Esc e não interfere em
 * mais nada (nunca chama preventDefault fora dessas duas teclas).
 *
 * DENTRO DO MODO o véu captura o clique de propósito: é o que permite "clicar no elemento" sem
 * navegar nem abrir o registro.
 */

interface AnotacaoNaTela extends Ancora {
  id: string;
  texto: string;
  status: string;
}

interface PinNaTela {
  anotacao: AnotacaoNaTela;
  left: number;
  top: number;
  precisao: Precisao;
}

interface Rascunho {
  ancora: Ancora;
  /** onde o balão abre (coordenadas de viewport) */
  left: number;
  top: number;
  print: { conteudo: string; largura: number; altura: number; printFx: number | null; printFy: number | null } | null;
}

const CLASSE_FORA_DO_PRINT = { "data-anotacoes-fora-do-print": "" } as const;

export function AnotacoesFerramenta({ usuarioId = "" }: { usuarioId?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [montado, setMontado] = useState(false);
  const [modo, setModo] = useState(false);
  const [anotacoes, setAnotacoes] = useState<AnotacaoNaTela[]>([]);
  const [pins, setPins] = useState<PinNaTela[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  const tela = useMemo(() => telaDaRota(pathname ?? "/", params?.toString()), [pathname, params]);
  const destacar = params?.get("anotacao") ?? null;

  useEffect(() => setMontado(true), []);

  /* ── a posição do botão: arrastável (mouse e dedo), lembrada neste navegador por usuário ── */
  const botaoRef = useRef<HTMLButtonElement>(null);
  const [posicao, setPosicao] = useState<Ponto | null>(null);
  const arraste = useRef<{ inicio: Ponto; origem: Ponto; movendo: boolean; id: number } | null>(null);
  const engolirClique = useRef(false);
  const chave = chavePosicaoBotao(usuarioId);
  const tamanhoBotao = () => {
    const r = botaoRef.current?.getBoundingClientRect();
    return { w: r?.width || 110, h: r?.height || 36 };
  };
  const janela = () => ({ w: window.innerWidth, h: window.innerHeight });
  const gravarPosicao = (p: Ponto | null) => {
    try { if (p) localStorage.setItem(chave, JSON.stringify(p)); else localStorage.removeItem(chave); } catch { /* sem armazenamento: vale só nesta visita */ }
  };
  useEffect(() => {
    let salva: Ponto | null = null;
    try { salva = lerPosicao(localStorage.getItem(chave)); } catch { salva = null; }
    if (salva) setPosicao(limitarPosicao(salva, tamanhoBotao(), janela()));
    // A janela encolheu: o botão volta para dentro da área visível
    const aoRedimensionar = () => setPosicao((p) => (p ? limitarPosicao(p, tamanhoBotao(), janela()) : p));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const aoApertar = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    arraste.current = { inicio: { x: e.clientX, y: e.clientY }, origem: { x: r.left, y: r.top }, movendo: false, id: e.pointerId };
  };
  const aoMover = (e: React.PointerEvent<HTMLButtonElement>) => {
    const a = arraste.current;
    if (!a || a.id !== e.pointerId) return;
    const agora = { x: e.clientX, y: e.clientY };
    if (!a.movendo) {
      if (!ehArraste(a.inicio, agora)) return;
      a.movendo = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    }
    setPosicao(posicaoArrastada(a.origem, a.inicio, agora, tamanhoBotao(), janela()));
  };
  const aoSoltar = (e: React.PointerEvent<HTMLButtonElement>) => {
    const a = arraste.current;
    arraste.current = null;
    if (!a || a.id !== e.pointerId || !a.movendo) return;
    // Foi arraste: grava onde ficou e não deixa o clique que vem em seguida ligar o modo
    engolirClique.current = true;
    const final = posicaoArrastada(a.origem, a.inicio, { x: e.clientX, y: e.clientY }, tamanhoBotao(), janela());
    setPosicao(final);
    gravarPosicao(final);
  };
  const voltarAoPadrao = () => { setPosicao(null); gravarPosicao(null); };

  /* ── o atalho: o único ouvinte que vive fora do modo ── */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setModo((m) => !m);
        return;
      }
      if (e.key === "Escape") {
        setRascunho((r) => (r ? null : r));
        setAberto(null);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  /* ── um link de "ir para a tela" com ?anotacao=… abre o modo já destacando o pin ── */
  useEffect(() => { if (destacar) setModo(true); }, [destacar]);

  /* ── as anotações desta tela (só quando o modo liga: nada de consulta no caminho normal) ── */
  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/anotacoes?tela=${encodeURIComponent(tela)}`);
      if (!r.ok) return;
      const d = await r.json();
      setAnotacoes(d.anotacoes ?? []);
    } catch { /* sem rede: a ferramenta não atrapalha a tela */ }
  }, [tela]);
  useEffect(() => { if (modo) carregar(); else { setAnotacoes([]); setPins([]); setRascunho(null); } }, [modo, carregar]);

  /* ── reancorar os pins: no scroll, no redimensionamento e quando a lista muda ── */
  const recalcular = useCallback(() => {
    const achados: PinNaTela[] = [];
    for (const a of anotacoes) {
      if (a.status === "descartada") continue;
      const { elemento, precisao } = reencontrar(document, a);
      if (!elemento) continue; // âncora perdida: sem pin aqui; a anotação vive na lista
      const p = pontoDoPin(elemento, a);
      achados.push({ anotacao: a, left: p.left, top: p.top, precisao });
    }
    setPins(achados);
  }, [anotacoes]);

  useEffect(() => {
    if (!modo) return;
    recalcular();
    const scroller = document.getElementById("conteudo-scroll");
    let quadro = 0;
    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(recalcular);
    };
    scroller?.addEventListener("scroll", agendar, { passive: true });
    window.addEventListener("scroll", agendar, { passive: true });
    window.addEventListener("resize", agendar);
    return () => {
      cancelAnimationFrame(quadro);
      scroller?.removeEventListener("scroll", agendar);
      window.removeEventListener("scroll", agendar);
      window.removeEventListener("resize", agendar);
    };
  }, [modo, recalcular]);

  /* ── o clique no modo: acha o elemento de baixo, ancora, tira o print e abre o balão ── */
  async function aoClicarNaTela(e: React.MouseEvent) {
    if (rascunho) { setRascunho(null); return; }
    const x = e.clientX;
    const y = e.clientY;
    // o véu está por cima: pega o primeiro elemento que NÃO é da ferramenta
    const abaixo = document
      .elementsFromPoint(x, y)
      .find((el) => !el.closest("[data-anotacoes-fora-do-print]"));
    if (!abaixo) return;
    const ancora = ancorarElemento(abaixo, x, y);

    setCapturando(true);
    let print: Rascunho["print"] = null;
    try {
      // o chunk da captura só baixa agora, na primeira anotação da sessão
      const { capturarPrintDaViewport } = await import("@/lib/anotacoes/print-cliente");
      print = await capturarPrintDaViewport({ x, y });
    } catch { /* sem print: a anotação salva do mesmo jeito */ } finally {
      setCapturando(false);
    }
    setTexto("");
    setRascunho({ ancora, print, left: x, top: y });
    setTimeout(() => campoRef.current?.focus(), 30);
  }

  async function salvar() {
    if (!rascunho || !texto.trim()) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/anotacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rascunho.ancora,
          tela,
          rota: `${pathname}${params?.toString() ? `?${params.toString()}` : ""}`,
          tituloTela: document.querySelector("h1")?.textContent?.trim().slice(0, 200) ?? null,
          texto: texto.trim(),
          print: rascunho.print,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível salvar a anotação.", "erro"); return; }
      toast(d.avisoPrint ? "Anotação salva sem print." : "Anotação salva.");
      setRascunho(null);
      setTexto("");
      await carregar();
    } catch {
      toast("Sem conexão. Tente de novo.", "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(id: string, status: string) {
    const r = await fetch(`/api/anotacoes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    }).catch(() => null);
    if (!r?.ok) { toast("Não foi possível mudar o status.", "erro"); return; }
    setAberto(null);
    await carregar();
  }

  if (!montado) return null;

  const corpo = (
    <>
      {/* O botão: discreto, só no desktop, empilhado ACIMA do Frivo IA — o canto de baixo da
          barra lateral é da logo do Frivo, e nada pode cobrir a logo. O z fica acima do véu
          (45) para que, em modo de anotação, clicar aqui SAIA do modo em vez de marcar um
          ponto; e abaixo da barra (48) e do balão (49), que mandam enquanto estão abertos. */}
      {/* Arrastável (mouse e dedo): a posição fica neste navegador; o "voltar" aparece ao lado quando foi movido */}
      <button
        ref={botaoRef}
        type="button"
        onClick={() => { if (engolirClique.current) { engolirClique.current = false; return; } setModo((m) => !m); }}
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={() => { arraste.current = null; }}
        {...CLASSE_FORA_DO_PRINT}
        data-anotacoes-botao
        data-movido={posicao ? "" : undefined}
        aria-pressed={modo}
        title={modo ? "Sair do modo anotação (Alt+A)" : "Anotar nesta tela (Alt+A). Arraste para mudar de lugar."}
        style={posicao ? { left: posicao.x, top: posicao.y } : undefined}
        className={cn(
          "fixed z-[47] hidden lg:inline-flex items-center gap-2 rounded-full border px-3 py-2 shadow-sm transition-colors touch-none select-none",
          !posicao && "right-4 bottom-[5rem]",
          modo
            ? "bg-acento text-white border-acento"
            : "bg-white text-ink-muted border-surface-border hover:text-ink hover:border-acento/40",
        )}
      >
        <MessageSquarePlus className="w-4 h-4" aria-hidden />
        <span className="text-xs font-semibold">{modo ? "Anotando" : "Anotar"}</span>
      </button>
      {posicao && (
        <button
          type="button" onClick={voltarAoPadrao} {...CLASSE_FORA_DO_PRINT} data-anotacoes-voltar
          title="Voltar o botão à posição padrão" aria-label="Voltar o botão de anotações à posição padrão"
          style={posicaoDoVoltar(posicao, botaoRef.current?.offsetWidth ?? 96)}
          className="fixed z-[47] hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-full border border-surface-border bg-white text-ink-muted shadow-sm hover:text-ink hover:border-acento/40"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}

      {modo && (
        <>
          {/* O véu: captura o clique para marcar o ponto sem navegar nem abrir registro */}
          <div
            {...CLASSE_FORA_DO_PRINT}
            data-anotacoes-veu
            onClick={aoClicarNaTela}
            className="fixed inset-0 z-[45] cursor-crosshair bg-acento/5"
          />

          {/* A barra do modo */}
          <div {...CLASSE_FORA_DO_PRINT} data-anotacoes-barra
            className="fixed z-[48] left-1/2 -translate-x-1/2 top-4 flex items-center gap-3 rounded-full bg-ink text-white px-4 py-2 shadow-elevated">
            <Pin className="w-3.5 h-3.5" aria-hidden />
            <span className="text-xs">Clique no ponto que quer anotar</span>
            <Link href="/anotacoes" className="text-xs font-semibold underline underline-offset-2" data-anotacoes-ver-lista>
              Minhas anotações
            </Link>
            <button type="button" onClick={() => setModo(false)} aria-label="Sair do modo anotação" className="text-white/70 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Os pins já ancorados nesta tela */}
          {pins.map((p) => (
            <div key={p.anotacao.id} {...CLASSE_FORA_DO_PRINT} className="fixed z-[46]"
              style={{ left: p.left, top: p.top, transform: "translate(-50%, -100%)" }}>
              <button
                type="button"
                onClick={() => setAberto((a) => (a === p.anotacao.id ? null : p.anotacao.id))}
                data-anotacoes-pin={p.anotacao.id}
                data-precisao={p.precisao}
                aria-label={`Anotação: ${p.anotacao.texto.slice(0, 40)}`}
                className={cn(
                  "flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold shadow-md ring-2 ring-white",
                  p.anotacao.status === "feita" ? "bg-ok" : p.precisao === "exata" ? "bg-acento" : "bg-atencao",
                  destacar === p.anotacao.id && "animate-pulse",
                )}
              >
                {p.anotacao.status === "feita" ? <Check className="w-3.5 h-3.5" /> : <Pin className="w-3 h-3" />}
              </button>

              {aberto === p.anotacao.id && (
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 rounded-card border border-surface-border bg-white p-3 shadow-elevated text-left"
                  data-anotacoes-cartao={p.anotacao.id}>
                  <p className="text-sm text-ink whitespace-pre-wrap">{p.anotacao.texto}</p>
                  {p.precisao !== "exata" && (
                    <p className="mt-1.5 text-[11px] text-atencao-texto">{ROTULO_PRECISAO[p.precisao]}</p>
                  )}
                  <div className="mt-2.5 flex items-center gap-2">
                    {p.anotacao.status !== "feita" ? (
                      <Button type="button" size="sm" variant="success" onClick={() => mudarStatus(p.anotacao.id, "feita")} data-anotacoes-feita>
                        <Check className="w-3.5 h-3.5" /> Feita
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="secondary" onClick={() => mudarStatus(p.anotacao.id, "aberta")}>
                        Reabrir
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" onClick={() => mudarStatus(p.anotacao.id, "descartada")}>
                      Descartar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* O balão de escrever, ancorado no ponto clicado */}
          {rascunho && (
            <div {...CLASSE_FORA_DO_PRINT} data-anotacoes-balao
              className="fixed z-[49] w-80 rounded-card border border-surface-border bg-white p-3 shadow-elevated"
              style={{
                left: Math.min(Math.max(12, rascunho.left - 160), Math.max(12, window.innerWidth - 332)),
                top: Math.min(Math.max(12, rascunho.top + 12), Math.max(12, window.innerHeight - 220)),
              }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink">Anotar aqui</p>
                  <p className="text-[11px] text-ink-muted truncate" data-anotacoes-alvo>
                    {rascunho.ancora.rotulo ?? rascunho.ancora.ancora ?? "ponto da tela"}
                  </p>
                </div>
                <button type="button" onClick={() => setRascunho(null)} aria-label="Fechar" className="text-ink-subtle hover:text-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Textarea
                ref={campoRef}
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, TEXTO_MAX))}
                placeholder="O que mudar aqui"
                rows={4}
                data-anotacoes-texto
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-subtle" data-anotacoes-estado-print>
                  {rascunho.print ? "Print do momento guardado" : "Sem print desta tela"}
                </span>
                <Button type="button" size="sm" loading={salvando} disabled={!texto.trim()} onClick={salvar} data-anotacoes-salvar>
                  Salvar
                </Button>
              </div>
            </div>
          )}

          {capturando && (
            <div {...CLASSE_FORA_DO_PRINT} className="fixed z-[49] right-4 top-4 inline-flex items-center gap-2 rounded-full bg-white border border-surface-border px-3 py-1.5 shadow-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-muted" />
              <span className="text-xs text-ink-muted">Guardando o print</span>
            </div>
          )}
        </>
      )}
    </>
  );

  return createPortal(corpo, document.body);
}
