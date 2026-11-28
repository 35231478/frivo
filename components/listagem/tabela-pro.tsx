"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as PointerEventReact, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, GripVertical, RotateCcw, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { CAMADA } from "@/lib/ui/camadas";
import { posicaoFlutuante, type PosicaoFlutuante } from "@/lib/ui/flutuante";
import { cliqueAbreLinha, destinoDoClique, teclaAbreLinha } from "@/lib/listagem/abrir-linha";
import { PLANILHA } from "@/lib/planilha";
import { useLinhasSelecionadas } from "@/components/listagem/selecao-linhas";
import {
  ajustarPreferencia, chaveTabela, LARGURA_MIN, lerPreferenciaTabela, moverColuna, ocultasEfetivas, ordenarColunas, PREFERENCIA_VAZIA,
  preferenciaVazia, type PreferenciaTabela,
} from "@/lib/preferencias";

/**
 * A tabela profissional das telas de lista (PR B): UM componente para Orçamentos, OS, Contas a
 * Receber/Pagar, Notas fiscais, Medições e os cadastros.
 *
 * - Colunas declaradas (id, título, alinhamento, largura, mínima, obrigatória, escondida por padrão).
 * - Cabeçalho com a borda arrastável (ponteiro; respeita a mínima; duplo clique volta ao padrão).
 * - Menu "Colunas": mostrar/esconder (as obrigatórias ficam travadas), REORDENAR (arrastar a alça com o
 *   mouse ou o dedo, ou as setas ↑ ↓ do teclado na alça) e "Restaurar padrão" (larguras, colunas e ordem).
 *   As colunas fixas (checkbox, ações) não se movem.
 * - Estilo PLANILHA único (lib/planilha): 13px em tudo, cabeçalho 10px maiúsculo, R$ à direita com
 *   números tabulares, código com a mesma fonte em todas as telas, nome só em peso.
 * - Preferência POR USUÁRIO (larguras + colunas + ordem) pela rota /api/preferencias/tabela:<tela>, com o
 *   localStorage como reserva enquanto carrega ou se a API falhar.
 * - No celular não há tabela: a tela passa os seus cartões em `cartoes`.
 *
 * As células chegam prontas (ReactNode): a página do servidor monta os links e pílulas como sempre fez
 * e o componente cuida só de larguras, colunas visíveis e estilo. Uma coluna SEM `largura` é a
 * elástica (ocupa o que sobra); cada tela precisa de pelo menos uma, senão o navegador estica todas.
 *
 * A LINHA INTEIRA abre o registro quando a tela dá o `href` da linha (lib/listagem/abrir-linha):
 * clique em qualquer célula, menos nos controles (checkbox, ações, links, campos) e nas colunas
 * fixas; Ctrl/⌘ + clique e o botão do meio abrem em nova aba; a linha entra no Tab e abre no Enter.
 * O link do número/nome continua existindo (botão direito › abrir em nova aba).
 */
/**
 * Coluna presa à direita: fundo sólido (o conteúdo que rola por baixo não aparece) acompanhando a zebra, o realce do
 * mouse e a seleção da linha, com uma sombra fina na borda esquerda.
 */
const GRUDADA_TD = "sticky right-0 z-[1] bg-white group-even/linha:bg-surface-alt group-hover/linha:bg-primary-50 group-data-[selecionada]/linha:bg-primary-50 shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.18)]";
const GRUDADA_TH = "sticky right-0 z-[2] bg-surface-alt shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.18)]";

export interface ColunaPro {
  id: string;
  /** Texto do cabeçalho (e do menu "Colunas") */
  titulo: string;
  /** Conteúdo do cabeçalho no lugar do título (ex.: o checkbox de selecionar a página); o título vai para o leitor de tela */
  cabecalho?: ReactNode;
  /** Cabeçalho visualmente vazio (coluna de ações): o título fica só para o leitor de tela */
  semTitulo?: boolean;
  alinhar?: "esquerda" | "direita" | "centro";
  /** Largura padrão em px. Sem largura = coluna elástica */
  largura?: number;
  /** Largura mínima ao arrastar (px) */
  minimo?: number;
  /** Não pode ser escondida */
  obrigatoria?: boolean;
  /** Escondida por padrão (o usuário liga no menu) */
  oculta?: boolean;
  /** Coluna de serviço (checkbox, ações): não redimensiona, não entra no menu e é sempre visível */
  fixa?: boolean;
  /**
   * Fica presa à direita quando a tabela rola na horizontal (ex.: as ações da linha, que numa gaveta estreita
   * sumiriam depois da última coluna)
   */
  grudada?: boolean;
  /** Chave de ordenação (o cabeçalho vira botão quando a tabela recebe `ordenacao`) */
  ordenar?: string;
  /** Classes extras do <td> (ex.: "truncate") */
  classe?: string;
}

export interface LinhaPro {
  id: string;
  celulas: Record<string, ReactNode>;
  /** Classes extras do <tr> (ex.: linha vermelha de atrasado) */
  classe?: string;
  /** Atributos extras do <tr> (data-*) */
  atributos?: Record<string, string | undefined>;
  /** title de cada célula (o texto inteiro no hover de uma célula truncada) */
  titulos?: Record<string, string | undefined>;
  /**
   * O registro que a linha inteira abre (sem ele e sem `aoAbrir` a linha é só leitura; quem não tem permissão não
   * recebe nenhum dos dois)
   */
  href?: string;
  /**
   * O que abrir a linha faz nesta aba, no lugar de ir ao `href` (ex.: a visualização rápida numa gaveta).
   * Ctrl/⌘ + clique e o botão do meio continuam abrindo o `href` em nova aba. Sem `href` (ex.: o cadastro que edita
   * numa gaveta), a linha abre só pelo `aoAbrir`, nesta aba.
   */
  aoAbrir?: () => void;
}

export interface OrdenacaoPro { ativa: string | null; dir: "asc" | "desc"; onOrdenar: (k: string) => void }

export interface TabelaProProps {
  /** Identifica a tela na preferência ("orcamentos", "cadastro-produtos") */
  tela: string;
  colunas: ColunaPro[];
  linhas: LinhaPro[];
  ordenacao?: OrdenacaoPro;
  /** Os cartões do celular (a tabela some abaixo da quebra) */
  cartoes?: ReactNode;
  /** O que vai à esquerda na faixa de cima da tabela (contador, totais…); o botão "Colunas" fica à direita */
  barra?: ReactNode;
  /** Quebra entre cartões e tabela: "md" (listas) ou "sm" (cadastros) */
  quebra?: "sm" | "md";
  className?: string;
  /** Atributos extras do <table> (data-* que os testes de cada tela já usam) */
  atributos?: Record<string, string | boolean | undefined>;
}

const ALINHAR = { esquerda: "text-left", direita: "text-right", centro: "text-center" } as const;
const chaveLocal = (chave: string) => `frivo:${chave}`;

/**
 * A preferência da tabela: o localStorage responde na hora (sem piscar depois do carregamento) e a
 * rota do usuário vem por trás. Quando o servidor tem a preferência, ela vence e atualiza a reserva;
 * quando ele não tem nada e o navegador tem, a do navegador sobe (quem já ajustou não perde).
 * Cada mudança grava nos dois: no navegador na hora e no servidor depois de uma pausa curta.
 */
export function usePreferenciaTabela(tela: string, colunas: ColunaPro[]) {
  const chave = chaveTabela(tela);
  const [pref, setPref] = useState<PreferenciaTabela>(PREFERENCIA_VAZIA);
  const colunasRef = useRef(colunas);
  colunasRef.current = colunas;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gravarLocal = useCallback((p: PreferenciaTabela) => {
    try { localStorage.setItem(chaveLocal(chave), JSON.stringify(p)); } catch { /* navegador sem storage: segue sem reserva */ }
  }, [chave]);
  const enviar = useCallback((p: PreferenciaTabela) => {
    fetch(`/api/preferencias/${chave}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).catch(() => {});
  }, [chave]);

  useEffect(() => {
    let local: PreferenciaTabela | null = null;
    try {
      const raw = localStorage.getItem(chaveLocal(chave));
      if (raw) { local = ajustarPreferencia(lerPreferenciaTabela(JSON.parse(raw)), colunasRef.current); setPref(local); }
    } catch { /* JSON torto ou sem storage: ignora */ }
    let vivo = true;
    fetch(`/api/preferencias/${chave}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { valor?: unknown } | null) => {
        if (!vivo || !j) return;
        if (j.valor) {
          const p = ajustarPreferencia(lerPreferenciaTabela(j.valor), colunasRef.current);
          setPref(p); gravarLocal(p);
        } else if (local && !preferenciaVaziaLocal(local)) {
          enviar(local);
        }
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [chave, gravarLocal, enviar]);

  const gravar = useCallback((p: PreferenciaTabela) => {
    setPref(p); gravarLocal(p);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; enviar(p); }, 600);
  }, [gravarLocal, enviar]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { pref, gravar };
}
const preferenciaVaziaLocal = preferenciaVazia;

/**
 * O roteador do App Router, ou nada fora dele (testes de componente montam a tabela sem o Next em
 * volta): a mesma quantidade de hooks nos dois casos, então a ordem não muda.
 */
function useRoteadorSeguro() {
  try { return useRouter(); } catch { return null; }
}

/** Abre o registro da linha: aqui (roteador) ou em nova aba */
export function abrirRegistro(href: string, destino: "mesma-aba" | "nova-aba", roteador: { push: (h: string) => void } | null) {
  if (destino === "nova-aba") { window.open(href, "_blank", "noopener"); return; }
  if (roteador) roteador.push(href); else window.location.assign(href);
}

export function TabelaPro({ tela, colunas, linhas, ordenacao, cartoes, barra, quebra = "md", className, atributos }: TabelaProProps) {
  const { pref, gravar } = usePreferenciaTabela(tela, colunas);
  const roteador = useRoteadorSeguro();
  // Linhas marcadas (seleção em massa ou seleção simples da lista em volta): ganham o realce permanente
  const selecionados = useLinhasSelecionadas();
  // Largura ao vivo enquanto arrasta (só grava ao soltar)
  const [arrastando, setArrastando] = useState<{ id: string; px: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // O menu "Colunas" abre em portal, fixo na tela (lib/ui/flutuante): nunca recortado pela altura da tabela
  const listaMenuRef = useRef<HTMLDivElement>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const [posMenu, setPosMenu] = useState<PosicaoFlutuante | null>(null);
  const reposicionar = useCallback(() => {
    const r = botaoMenuRef.current?.getBoundingClientRect();
    if (r) setPosMenu(posicaoFlutuante(r, { largura: window.innerWidth, altura: window.innerHeight }, 420));
  }, []);
  useLayoutEffect(() => { if (menu) reposicionar(); else setPosMenu(null); }, [menu, reposicionar]);
  useEffect(() => {
    if (!menu) return;
    // A página rolou (não o próprio menu) ou a janela mudou: o menu acompanha o botão
    const onScroll = (e: Event) => { if (!listaMenuRef.current?.contains(e.target as Node)) reposicionar(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", reposicionar);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", reposicionar); };
  }, [menu, reposicionar]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (menuRef.current?.contains(alvo) || listaMenuRef.current?.contains(alvo)) return;
      setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  // A ordem do usuário (as fixas não se movem); durante o arraste no menu, a ordem prevista
  const [arrasteColuna, setArrasteColuna] = useState<{ id: string; ordem: string[] } | null>(null);
  const ordenadas = useMemo(() => ordenarColunas(colunas, arrasteColuna?.ordem ?? pref.ordem), [colunas, pref.ordem, arrasteColuna]);
  const ocultas = useMemo(() => ocultasEfetivas(pref, colunas), [pref, colunas]);
  const visiveis = useMemo(() => ordenadas.filter((c) => c.fixa || !ocultas.has(c.id)), [ordenadas, ocultas]);
  const largura = (c: ColunaPro): number | undefined => {
    if (arrastando?.id === c.id) return arrastando.px;
    return pref.larguras[c.id] ?? c.largura;
  };
  const minimo = (c: ColunaPro) => c.minimo ?? LARGURA_MIN;
  // Soma das larguras fixas (+ um respiro para a elástica): abaixo disso a tabela rola na horizontal
  const minWidth = visiveis.reduce((s, c) => s + (largura(c) ?? 160), 0);

  const iniciarArraste = (c: ColunaPro) => (e: PointerEventReact<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const th = e.currentTarget.parentElement as HTMLElement;
    const inicio = th.getBoundingClientRect().width || largura(c) || 160;
    const x0 = e.clientX;
    const alvo = e.currentTarget;
    alvo.setPointerCapture?.(e.pointerId);
    let atual = Math.round(inicio);
    const mover = (ev: PointerEvent) => { atual = Math.max(minimo(c), Math.round(inicio + (ev.clientX - x0))); setArrastando({ id: c.id, px: atual }); };
    const soltar = () => {
      alvo.removeEventListener("pointermove", mover); alvo.removeEventListener("pointerup", soltar); alvo.removeEventListener("pointercancel", soltar);
      setArrastando(null);
      gravar({ ...pref, larguras: { ...pref.larguras, [c.id]: atual } });
    };
    alvo.addEventListener("pointermove", mover); alvo.addEventListener("pointerup", soltar); alvo.addEventListener("pointercancel", soltar);
  };
  const restaurarLargura = (c: ColunaPro) => {
    if (!(c.id in pref.larguras)) return;
    const larguras = { ...pref.larguras }; delete larguras[c.id];
    gravar({ ...pref, larguras });
  };
  const alternar = (c: ColunaPro) => {
    if (c.obrigatoria || c.fixa) return;
    const prox = new Set(ocultas);
    if (prox.has(c.id)) prox.delete(c.id); else prox.add(c.id);
    gravar({ ...pref, ocultas: colunas.filter((x) => prox.has(x.id)).map((x) => x.id) });
  };
  const restaurar = () => { gravar(PREFERENCIA_VAZIA); setMenu(false); setAviso("Colunas restauradas ao padrão."); };
  const personalizada = !preferenciaVazia(pref);
  const noMenu = ordenadas.filter((c) => !c.fixa);

  // ── Reordenar no menu: teclado (setas na alça) e arrastar (mouse ou dedo) ──
  const [aviso, setAviso] = useState("");
  const itensMenu = useRef(new Map<string, HTMLElement>());
  const focarAlca = useRef<string | null>(null);
  useEffect(() => {
    if (!focarAlca.current) return;
    (itensMenu.current.get(focarAlca.current)?.querySelector("[data-mover-coluna]") as HTMLElement | null)?.focus();
    focarAlca.current = null;
  });
  const reordenar = (id: string, para: number) => {
    const ids = noMenu.map((c) => c.id);
    const ordem = moverColuna(ids, id, para);
    if (ordem === ids) return;
    focarAlca.current = id;
    gravar({ ...pref, ordem });
    const c = colunas.find((x) => x.id === id);
    setAviso(`${c?.titulo ?? id}: posição ${ordem.indexOf(id) + 1} de ${ordem.length}.`);
  };
  const teclaAlca = (c: ColunaPro) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = noMenu.findIndex((x) => x.id === c.id);
    const alvo = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? noMenu.length - 1 : null;
    if (alvo === null) return;
    e.preventDefault();
    reordenar(c.id, alvo);
  };
  /** Onde o ponteiro está na lista do menu: o índice do item sob ele (pelo meio de cada um) */
  const indiceSob = (y: number, ids: string[]) => {
    let i = 0;
    for (const id of ids) {
      const r = itensMenu.current.get(id)?.getBoundingClientRect();
      if (r && y > r.top + r.height / 2) i++;
    }
    return i;
  };
  const arrastarAlca = (c: ColunaPro) => (e: PointerEventReact<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const alvo = e.currentTarget;
    alvo.setPointerCapture?.(e.pointerId);
    const inicial = noMenu.map((x) => x.id);
    let ordem = inicial;
    setArrasteColuna({ id: c.id, ordem });
    const mover = (ev: PointerEvent) => {
      const semEle = inicial.filter((x) => x !== c.id);
      const para = indiceSob(ev.clientY, semEle);
      ordem = moverColuna(inicial, c.id, para);
      setArrasteColuna({ id: c.id, ordem });
    };
    const soltar = () => {
      alvo.removeEventListener("pointermove", mover); alvo.removeEventListener("pointerup", soltar); alvo.removeEventListener("pointercancel", soltar);
      setArrasteColuna(null);
      if (ordem.some((id, i) => id !== inicial[i])) {
        gravar({ ...pref, ordem });
        setAviso(`${c.titulo}: posição ${ordem.indexOf(c.id) + 1} de ${ordem.length}.`);
      }
    };
    alvo.addEventListener("pointermove", mover); alvo.addEventListener("pointerup", soltar); alvo.addEventListener("pointercancel", soltar);
  };

  const esconder = quebra === "sm" ? "sm:hidden" : "md:hidden";
  const mostrar = quebra === "sm" ? "hidden sm:block" : "hidden md:block";

  return (
    <div className={className} data-tabela-pro={tela}>
      {cartoes !== undefined && <div className={esconder}>{cartoes}</div>}
      <div className={mostrar}>
        {/* Faixa de cima: o que a tela quiser à esquerda; "Colunas" à direita */}
        <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-surface-border">
          <div className="min-w-0 text-xs text-ink-muted">{barra}</div>
          <div ref={menuRef} className="relative shrink-0">
            <button
              ref={botaoMenuRef} type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} data-colunas-menu
              className={cn("inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold border transition-colors",
                menu || personalizada ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:text-primary-700 hover:bg-primary-50")}
              title="Escolher as colunas e restaurar o padrão"
            >
              <Settings2 className="w-3.5 h-3.5" aria-hidden /> Colunas
            </button>
            {menu && posMenu && createPortal(
              <div ref={listaMenuRef} role="menu" aria-label="Colunas" style={posMenu}
                className={cn("fixed w-60 overflow-y-auto overscroll-contain bg-white border border-surface-border rounded-lg shadow-elevated py-1", CAMADA.flutuante)} data-menu-colunas>
                {noMenu.map((c) => {
                  const visivel = !ocultas.has(c.id);
                  const travada = !!c.obrigatoria;
                  return (
                    <div key={c.id} role="none" data-item-coluna={c.id}
                      ref={(el) => { if (el) itensMenu.current.set(c.id, el); else itensMenu.current.delete(c.id); }}
                      className={cn("flex items-center", arrasteColuna?.id === c.id && "bg-primary-50 ring-1 ring-primary-200")}>
                      <button
                        type="button" role="menuitem" data-mover-coluna={c.id} aria-label={`Mover a coluna ${c.titulo}`}
                        title="Arraste para mudar a ordem (no teclado: setas ↑ ↓)"
                        onKeyDown={teclaAlca(c)} onPointerDown={arrastarAlca(c)}
                        className="pl-2 pr-1 py-2 text-ink-subtle hover:text-ink cursor-grab active:cursor-grabbing touch-none select-none rounded focus-visible:outline-2 focus-visible:outline-primary-500"
                      >
                        <GripVertical className="w-3.5 h-3.5" aria-hidden />
                      </button>
                      <button
                        type="button" role="menuitemcheckbox" aria-checked={visivel} disabled={travada}
                        onClick={() => alternar(c)} data-coluna-opcao={c.id}
                        className={cn("flex-1 min-w-0 flex items-center justify-between gap-2 pl-1 pr-3 py-2 text-sm text-left hover:bg-surface-alt disabled:cursor-default disabled:hover:bg-transparent",
                          visivel ? "text-ink" : "text-ink-muted")}
                        title={travada ? "Esta coluna não pode ser escondida" : undefined}
                      >
                        <span className="truncate">{c.titulo}</span>
                        <span className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0",
                          visivel ? "bg-primary-500 border-primary-500 text-white" : "border-surface-border bg-white", travada && "opacity-50")} aria-hidden>
                          {visivel && <Check className="w-3 h-3" />}
                        </span>
                      </button>
                    </div>
                  );
                })}
                <div className="border-t border-surface-border mt-1 pt-1">
                  <button type="button" role="menuitem" onClick={restaurar} disabled={!personalizada} data-restaurar-colunas
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-primary-700 font-medium hover:bg-surface-alt disabled:opacity-40 disabled:hover:bg-transparent">
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Restaurar padrão
                  </button>
                </div>
              </div>,
              document.body,
            )}
            {/* O que mudou na ordem, para o leitor de tela */}
            <span className="sr-only" aria-live="polite" data-aviso-colunas>{aviso}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className={cn(PLANILHA.tabela, "table-fixed", arrastando && "select-none")} data-tabela-planilha style={{ minWidth }} {...atributos}>
            <colgroup>
              {visiveis.map((c) => <col key={c.id} data-col={c.id} style={largura(c) ? { width: largura(c) } : undefined} />)}
            </colgroup>
            <thead>
              <tr className={PLANILHA.cabecalho}>
                {visiveis.map((c) => {
                  const al = ALINHAR[c.alinhar ?? "esquerda"];
                  const ordenavel = !!(c.ordenar && ordenacao);
                  const ativa = ordenavel && ordenacao!.ativa === c.ordenar;
                  return (
                    <th
                      key={c.id} scope="col" data-coluna={c.id}
                      className={cn(PLANILHA.th, al, "relative whitespace-nowrap overflow-hidden", c.semTitulo && "py-0.5", c.grudada && GRUDADA_TH)}
                      aria-sort={ativa ? (ordenacao!.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {c.cabecalho !== undefined ? (
                        <>{c.cabecalho}<span className="sr-only">{c.titulo}</span></>
                      ) : c.semTitulo ? (
                        <span className="sr-only">{c.titulo}</span>
                      ) : ordenavel ? (
                        <button type="button" onClick={() => ordenacao!.onOrdenar(c.ordenar!)} data-ordenar={c.ordenar}
                          className={cn("inline-flex items-center gap-1 max-w-full uppercase hover:text-ink transition-colors", ativa && "text-ink", c.alinhar === "direita" && "flex-row-reverse")}>
                          <span className="truncate">{c.titulo}</span>
                          {ativa ? (ordenacao!.dir === "asc" ? <ArrowUp className="w-3 h-3 shrink-0" /> : <ArrowDown className="w-3 h-3 shrink-0" />) : <ArrowUpDown className="w-3 h-3 opacity-40 shrink-0" />}
                        </button>
                      ) : (
                        <span className="block truncate">{c.titulo}</span>
                      )}
                      {!c.fixa && (
                        <span
                          role="separator" aria-orientation="vertical" aria-label={`Redimensionar a coluna ${c.titulo}`} data-redimensionar={c.id}
                          onPointerDown={iniciarArraste(c)} onDoubleClick={() => restaurarLargura(c)}
                          title="Arraste para mudar a largura; duplo clique volta ao padrão"
                          className={cn("absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary-300/60", arrastando?.id === c.id && "bg-primary-400")}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const abre = !!(l.href || l.aoAbrir);
                return (
                <tr key={l.id} data-linha={l.id} data-abrir={l.href ?? (l.aoAbrir ? "" : undefined)}
                  className={cn("group/linha", PLANILHA.linha, PLANILHA.linhaHover, abre && PLANILHA.linhaAbre, l.classe, selecionados?.has(l.id) && PLANILHA.linhaSelecionada)}
                  aria-selected={selecionados ? selecionados.has(l.id) : undefined} data-selecionada={selecionados?.has(l.id) ? "" : undefined}
                  tabIndex={abre ? 0 : undefined}
                  onClick={abre ? (e) => {
                    const destino = destinoDoClique(e);
                    if (destino === "nenhum" || !cliqueAbreLinha(e.target as Element, e.currentTarget, window.getSelection()?.toString())) return;
                    if ((destino === "mesma-aba" || !l.href) && l.aoAbrir) { l.aoAbrir(); return; }
                    if (l.href) abrirRegistro(l.href, destino, roteador);
                  } : undefined}
                  onAuxClick={l.href ? (e) => {
                    if (e.button !== 1 || !cliqueAbreLinha(e.target as Element, e.currentTarget)) return;
                    e.preventDefault();
                    abrirRegistro(l.href!, "nova-aba", roteador);
                  } : undefined}
                  onKeyDown={abre ? (e) => {
                    if (!teclaAbreLinha(e)) return;
                    e.preventDefault();
                    const novaAba = (e.ctrlKey || e.metaKey) && !!l.href;
                    if (!novaAba && l.aoAbrir) { l.aoAbrir(); return; }
                    if (l.href) abrirRegistro(l.href, novaAba ? "nova-aba" : "mesma-aba", roteador);
                  } : undefined}
                  {...l.atributos}>
                  {visiveis.map((c) => (
                    <td key={c.id} className={cn(PLANILHA.td, "align-middle", ALINHAR[c.alinhar ?? "esquerda"], c.alinhar === "direita" && "tabular-nums whitespace-nowrap", c.classe, c.grudada && GRUDADA_TD)}
                      title={l.titulos?.[c.id]} data-celula={c.id} data-fixa={c.fixa ? "" : undefined} data-grudada={c.grudada ? "" : undefined}>
                      {l.celulas[c.id]}
                    </td>
                  ))}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
