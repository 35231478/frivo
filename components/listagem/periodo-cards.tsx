"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { InputData } from "@/components/ui/input-data";
import { cn, formatarMoeda } from "@/lib/utils";
import { ATALHOS, ehAtual, nomeAtalho, PARAMS_PERIODO, urlDoAtalho, urlVizinho, type Periodo, type TipoPeriodo } from "@/lib/periodo";

type Navegar = (m: Record<string, string | null>) => void;
/** O período lido da URL no servidor (lerPeriodo), sem os instantes (não passam para o cliente) */
export type PeriodoTela = Omit<Periodo, "gte" | "lt" | "ref" | "dias"> & Partial<Pick<Periodo, "ref" | "dias">>;
/** O que a página manda para a tela (tira os Date) */
export const periodoTela = (p: Periodo): PeriodoTela => ({ tipo: p.tipo, mes: p.mes, de: p.de, ate: p.ate, ref: p.ref, dias: p.dias, rotulo: p.rotulo });

/**
 * Seletor de período compacto (padrão da casa, estilo Conta Azul): ‹ [calendário · rótulo · atalho] ›.
 * O menu tem os atalhos (Hoje · Esta semana · Este mês · Este ano · Últimos 30 dias · Últimos 12 meses ·
 * Todo o período · Período personalizado) e as setas andam uma unidade do atalho escolhido. Tudo na
 * URL via `navegar` (compartilhável; o "voltar" do navegador funciona). O mês atual não vai para a URL.
 */
export function BarraPeriodo({ periodo, navegar, permitirTodos, somenteMes, dica, className }: {
  periodo: PeriodoTela; navegar: Navegar;
  /** Mostra "Todo o período" (ex.: Contas a Receber — busca de uma conta antiga) */
  permitirTodos?: boolean;
  /** Só mês a mês (sem atalhos nem "Período personalizado"): telas por competência */
  somenteMes?: boolean;
  /** ⓘ do que a data do período significa (ex.: "Pela data de vencimento.") */
  dica?: string;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [personalizado, setPersonalizado] = useState(periodo.tipo === "intervalo");
  const [de, setDe] = useState(periodo.de ?? "");
  const [ate, setAte] = useState(periodo.ate ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setDe(periodo.de ?? ""); setAte(periodo.ate ?? ""); setPersonalizado(periodo.tipo === "intervalo"); }, [periodo.de, periodo.ate, periodo.tipo]);
  useEffect(() => {
    if (!aberto) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [aberto]);

  const p = periodo as Periodo;
  const atual = ehAtual(p);
  const anterior = urlVizinho(p, -1), seguinte = urlVizinho(p, 1);
  const ir = (m: Record<string, string | null> | null) => { if (m) navegar(m); };
  const escolher = (tipo: TipoPeriodo) => {
    if (tipo === "intervalo") { setPersonalizado(true); return; }
    setAberto(false); setPersonalizado(false);
    navegar(urlDoAtalho(tipo));
  };
  const aplicarIntervalo = () => { setAberto(false); setPersonalizado(false); navegar({ ...PARAMS_PERIODO, de: de || null, ate: ate || null }); };
  const opcoes = somenteMes ? ATALHOS.filter((a) => a.tipo === "mes") : ATALHOS.filter((a) => a.tipo !== "todos" || permitirTodos);
  const seta = "px-3 self-stretch text-primary-600 hover:bg-primary-50 disabled:opacity-30 disabled:hover:bg-transparent";
  // O que o atalho significa (vai no title do seletor; o rótulo já diz o período)
  const atalho = periodo.tipo === "intervalo" ? "Período personalizado" : periodo.tipo === "todos" ? "" : atual ? nomeAtalho(periodo.tipo) : `${nomeAtalho(periodo.tipo)} (navegado)`;

  return (
    <div className={cn("flex flex-col gap-1", className)} data-periodo={periodo.tipo}>
      <span className="text-xs font-medium text-ink-muted">Período</span>
      <div className="flex items-center gap-2">
      <div ref={ref} className="relative flex-1 sm:flex-none">
        <div className="flex w-full sm:w-auto items-stretch h-10 rounded-lg border border-surface-border bg-white overflow-hidden">
          <button type="button" onClick={() => ir(anterior)} disabled={!anterior} aria-label="Período anterior" title="Período anterior" className={seta} data-mes-anterior><ChevronLeft className="w-4 h-4" /></button>
          <button
            type="button" onClick={() => setAberto((v) => !v)} aria-haspopup="listbox" aria-expanded={aberto} data-periodo-menu data-periodo-atalho={atalho || undefined} title={atalho || undefined}
            className={cn("flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold text-primary-700 min-w-0 sm:min-w-[13rem] border-x border-surface-border",
              aberto ? "bg-primary-100" : "bg-primary-50 hover:bg-primary-100")}
          >
            {periodo.tipo === "intervalo"
              ? <span className="truncate" data-periodo-rotulo>{periodo.rotulo}</span>
              : <span className="truncate" data-mes-rotulo>{periodo.rotulo}</span>}
            {!somenteMes && <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform", aberto && "rotate-180")} aria-hidden />}
          </button>
          <button type="button" onClick={() => ir(seguinte)} disabled={!seguinte} aria-label="Período seguinte" title="Período seguinte" className={seta} data-mes-seguinte><ChevronRight className="w-4 h-4" /></button>
        </div>

        {aberto && !somenteMes && (
          <div className="absolute z-40 left-0 sm:left-10 mt-1 w-full sm:w-72 max-h-80 overflow-y-auto bg-white border border-surface-border rounded-lg shadow-elevated py-1" data-periodo-opcoes>
            <ul role="listbox" aria-label="Período">
              {opcoes.map((a) => {
                const ativo = a.tipo === periodo.tipo && (a.tipo !== "intervalo" || !personalizado);
                return (
                  <li key={a.tipo} role="option" aria-selected={ativo}>
                    <button
                      type="button" onClick={() => escolher(a.tipo)} data-periodo-opcao={a.tipo}
                      {...(a.tipo === "todos" ? { "data-todo-periodo": true } : a.tipo === "intervalo" ? { "data-alternar-periodo": true } : {})}
                      className={cn("w-full px-4 py-2.5 text-sm text-left hover:bg-surface-alt", ativo ? "bg-primary-50 text-primary-700 font-semibold" : "text-ink")}
                    >
                      {a.nome}
                    </button>
                  </li>
                );
              })}
            </ul>
            {personalizado && (
              <div className="border-t border-surface-border px-3 py-2.5 space-y-2" data-intervalo>
                <div className="flex items-center gap-2">
                  <div className="flex-1"><InputData value={de} onChange={setDe} aria-label="De" /></div>
                  <span className="text-xs text-ink-muted">até</span>
                  <div className="flex-1"><InputData value={ate} onChange={setAte} aria-label="Até" /></div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPersonalizado(false)} className="text-sm text-ink-muted hover:text-ink px-2 py-1">Cancelar</button>
                  <button type="button" onClick={aplicarIntervalo} disabled={!de && !ate}
                    className="text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 px-4 py-1.5 rounded-lg disabled:opacity-50" data-aplicar-intervalo>Aplicar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {dica && <Dica texto={dica} rotulo="Período" />}
      </div>
    </div>
  );
}

/** A grade dos cards de resumo (2 por linha no celular — o último, se sobrar sozinho, ocupa a linha; todos numa linha no desktop largo) */
export function GradeCards({ colunas, children }: { colunas: 4 | 5 | 6; children: ReactNode }) {
  const xl = { 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" }[colunas];
  return <div className={cn("grid grid-cols-2 md:grid-cols-3 gap-3 max-md:[&>*:last-child:nth-child(odd)]:col-span-2", xl)} data-cards>{children}</div>;
}

/**
 * Card de resumo do período: ícone, rótulo (+ ⓘ), valor em R$ e a quantidade. Clicável como filtro
 * (`onClick` + `ativo`: clicar de novo tira o filtro) ou como link (`href`). O ⓘ fica FORA do
 * elemento clicável (botão dentro de botão/link é HTML inválido e quebra a hidratação).
 */
export function CardResumo({ id, rotulo, icone: Icone, cor, q, v, legenda, unidade, dica, href, ativo, onClick }: {
  id: string; rotulo: string; icone: ComponentType<{ className?: string }>; cor: string; q?: number; v: number;
  legenda?: string; unidade?: [string, string]; dica?: string; href?: string; ativo?: boolean; onClick?: () => void;
}) {
  const corpo = (
    <>
      <div className="flex items-start justify-between gap-1">
        <Icone className={cn("w-5 h-5", cor)} />
        {ativo && <X className={cn("w-3.5 h-3.5 text-ink-subtle", dica && "mr-6")} />}
      </div>
      <p className="text-xs text-ink-muted mt-2">{rotulo}</p>
      <p className="text-lg font-bold text-ink mt-0.5 tabular-nums" data-card-valor>{formatarMoeda(v)}</p>
      <p className="text-[11px] text-ink-subtle mt-0.5" data-card-qtd>{legenda ?? `${q} ${unidade ? (q === 1 ? unidade[0] : unidade[1]) : q === 1 ? "nota" : "notas"}`}</p>
    </>
  );
  const cls = cn("block h-full w-full text-left rounded-card border border-surface-border bg-white p-3.5 transition-all", (href || onClick) && "hover:shadow-card hover:border-primary-200",
    ativo && "bg-primary-50 ring-2 ring-offset-1 ring-primary-200");
  const card = href ? <Link href={href} className={cls} data-card={id}>{corpo}</Link>
    : onClick ? <button type="button" onClick={onClick} aria-pressed={!!ativo} className={cls} data-card={id}>{corpo}</button>
    : <div className={cls} data-card={id}>{corpo}</div>;
  return (
    <div className="relative" data-card-caixa={id}>
      {card}
      {dica && <span className="absolute top-3 right-3"><Dica texto={dica} rotulo={rotulo} /></span>}
    </div>
  );
}
