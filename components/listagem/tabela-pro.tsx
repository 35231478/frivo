"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as PointerEventReact, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, RotateCcw, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import { useLinhasSelecionadas } from "@/components/listagem/selecao-linhas";
import {
  ajustarPreferencia, chaveTabela, LARGURA_MIN, lerPreferenciaTabela, ocultasEfetivas, PREFERENCIA_VAZIA, type PreferenciaTabela,
} from "@/lib/preferencias";

/**
 * A tabela profissional das telas de lista (PR B): UM componente para Orçamentos, OS, Contas a
 * Receber/Pagar, Notas fiscais, Medições e os cadastros.
 *
 * - Colunas declaradas (id, título, alinhamento, largura, mínima, obrigatória, escondida por padrão).
 * - Cabeçalho com a borda arrastável (ponteiro; respeita a mínima; duplo clique volta ao padrão).
 * - Menu "Colunas": mostrar/esconder (as obrigatórias ficam travadas) e "Restaurar padrão".
 * - Estilo PLANILHA único (lib/planilha): 13px em tudo, cabeçalho 10px maiúsculo, R$ à direita com
 *   números tabulares, código com a mesma fonte em todas as telas, nome só em peso.
 * - Preferência POR USUÁRIO (larguras + colunas) pela rota /api/preferencias/tabela:<tela>, com o
 *   localStorage como reserva enquanto carrega ou se a API falhar.
 * - No celular não há tabela: a tela passa os seus cartões em `cartoes`.
 *
 * As células chegam prontas (ReactNode): a página do servidor monta os links e pílulas como sempre fez
 * e o componente cuida só de larguras, colunas visíveis e estilo. Uma coluna SEM `largura` é a
 * elástica (ocupa o que sobra); cada tela precisa de pelo menos uma, senão o navegador estica todas.
 */
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
const preferenciaVaziaLocal = (p: PreferenciaTabela) => Object.keys(p.larguras).length === 0 && p.ocultas === undefined;

export function TabelaPro({ tela, colunas, linhas, ordenacao, cartoes, barra, quebra = "md", className, atributos }: TabelaProProps) {
  const { pref, gravar } = usePreferenciaTabela(tela, colunas);
  // Linhas marcadas (seleção em massa ou seleção simples da lista em volta): ganham o realce permanente
  const selecionados = useLinhasSelecionadas();
  // Largura ao vivo enquanto arrasta (só grava ao soltar)
  const [arrastando, setArrastando] = useState<{ id: string; px: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  const ocultas = useMemo(() => ocultasEfetivas(pref, colunas), [pref, colunas]);
  const visiveis = useMemo(() => colunas.filter((c) => c.fixa || !ocultas.has(c.id)), [colunas, ocultas]);
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
  const restaurar = () => { gravar(PREFERENCIA_VAZIA); setMenu(false); };
  const personalizada = Object.keys(pref.larguras).length > 0 || pref.ocultas !== undefined;
  const noMenu = colunas.filter((c) => !c.fixa);

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
              type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} data-colunas-menu
              className={cn("inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold border transition-colors",
                menu || personalizada ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:text-primary-700 hover:bg-primary-50")}
              title="Escolher as colunas e restaurar o padrão"
            >
              <Settings2 className="w-3.5 h-3.5" aria-hidden /> Colunas
            </button>
            {menu && (
              <div role="menu" aria-label="Colunas" className="absolute z-40 right-0 mt-1 w-60 max-h-[70vh] overflow-y-auto bg-white border border-surface-border rounded-lg shadow-elevated py-1" data-menu-colunas>
                {noMenu.map((c) => {
                  const visivel = !ocultas.has(c.id);
                  const travada = !!c.obrigatoria;
                  return (
                    <button
                      key={c.id} type="button" role="menuitemcheckbox" aria-checked={visivel} disabled={travada}
                      onClick={() => alternar(c)} data-coluna-opcao={c.id}
                      className={cn("w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-surface-alt disabled:cursor-default disabled:hover:bg-transparent",
                        visivel ? "text-ink" : "text-ink-muted")}
                      title={travada ? "Esta coluna não pode ser escondida" : undefined}
                    >
                      <span className="truncate">{c.titulo}</span>
                      <span className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0",
                        visivel ? "bg-primary-500 border-primary-500 text-white" : "border-surface-border bg-white", travada && "opacity-50")} aria-hidden>
                        {visivel && <Check className="w-3 h-3" />}
                      </span>
                    </button>
                  );
                })}
                <div className="border-t border-surface-border mt-1 pt-1">
                  <button type="button" role="menuitem" onClick={restaurar} disabled={!personalizada} data-restaurar-colunas
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-primary-700 font-medium hover:bg-surface-alt disabled:opacity-40 disabled:hover:bg-transparent">
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Restaurar padrão
                  </button>
                </div>
              </div>
            )}
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
                      className={cn(PLANILHA.th, al, "relative whitespace-nowrap overflow-hidden", c.semTitulo && "py-0.5")}
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
              {linhas.map((l) => (
                <tr key={l.id} data-linha={l.id} className={cn(PLANILHA.linha, PLANILHA.linhaHover, l.classe, selecionados?.has(l.id) && PLANILHA.linhaSelecionada)}
                  aria-selected={selecionados ? selecionados.has(l.id) : undefined} data-selecionada={selecionados?.has(l.id) ? "" : undefined} {...l.atributos}>
                  {visiveis.map((c) => (
                    <td key={c.id} className={cn(PLANILHA.td, "align-middle", ALINHAR[c.alinhar ?? "esquerda"], c.alinhar === "direita" && "tabular-nums whitespace-nowrap", c.classe)}
                      title={l.titulos?.[c.id]} data-celula={c.id}>
                      {l.celulas[c.id]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
