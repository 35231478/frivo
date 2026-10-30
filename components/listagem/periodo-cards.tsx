"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight, Infinity as Todos, X } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { InputData } from "@/components/ui/input-data";
import { cn, formatarMoeda } from "@/lib/utils";
import { mesAtual, mesVizinho, rotuloMes, type Periodo } from "@/lib/periodo";

type Navegar = (m: Record<string, string | null>) => void;
export type PeriodoTela = Pick<Periodo, "tipo" | "mes" | "de" | "ate" | "rotulo">;

/**
 * Período das telas financeiras (padrão da casa): ‹ Mês Ano ›, "Período personalizado" (de/até)
 * e, onde a tela permite, "Todo o período". Tudo na URL via `navegar` (compartilhável; o "voltar"
 * do navegador funciona). O mês atual não vai para a URL (é o padrão).
 */
export function BarraPeriodo({ periodo, navegar, permitirTodos, dica }: {
  /** O período lido da URL no servidor (lerPeriodo), sem os instantes */
  periodo: PeriodoTela; navegar: Navegar;
  /** Mostra "Todo o período" (ex.: Contas a Receber — busca de uma conta antiga) */
  permitirTodos?: boolean;
  /** ⓘ do que a data do período significa (ex.: "Pela data de vencimento.") */
  dica?: string;
}) {
  const [personalizado, setPersonalizado] = useState(periodo.tipo === "intervalo");
  const [de, setDe] = useState(periodo.de ?? "");
  const [ate, setAte] = useState(periodo.ate ?? "");
  const mes = periodo.mes ?? mesAtual();
  const limpo = { de: null, ate: null, periodo: null };
  const irMes = (m: string) => { setPersonalizado(false); navegar({ ...limpo, mes: m === mesAtual() ? null : m }); };
  return (
    <div className="flex flex-wrap items-center gap-2" data-periodo={periodo.tipo}>
      {personalizado ? (
        <div className="flex flex-wrap items-end gap-2" data-intervalo>
          <div className="w-40"><InputData value={de} onChange={setDe} aria-label="De" /></div>
          <span className="text-sm text-ink-muted pb-2">até</span>
          <div className="w-40"><InputData value={ate} onChange={setAte} aria-label="Até" /></div>
          <button type="button" onClick={() => navegar({ ...limpo, de: de || null, ate: ate || null, mes: null })} disabled={!de && !ate}
            className="text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 px-4 py-2 rounded-lg disabled:opacity-50" data-aplicar-intervalo>Aplicar</button>
        </div>
      ) : periodo.tipo === "todos" ? (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink" data-mes-rotulo>
          <Todos className="w-4 h-4 text-ink-muted" /> Todo o período
        </span>
      ) : (
        <div className="inline-flex items-center rounded-lg border border-surface-border bg-white">
          <button type="button" onClick={() => irMes(mesVizinho(mes, -1))} aria-label="Mês anterior" className="p-2 text-ink-muted hover:text-primary-600" data-mes-anterior><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-2 min-w-[9.5rem] text-center text-sm font-semibold text-ink" data-mes-rotulo>{rotuloMes(mes)}</span>
          <button type="button" onClick={() => irMes(mesVizinho(mes, 1))} aria-label="Mês seguinte" className="p-2 text-ink-muted hover:text-primary-600" data-mes-seguinte><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}
      {personalizado || periodo.tipo === "todos" ? (
        <button type="button" onClick={() => irMes(mesAtual())} className="inline-flex items-center gap-1.5 text-sm text-acento hover:underline px-1" data-alternar-periodo>
          <X className="w-3.5 h-3.5" /> Voltar ao mês atual
        </button>
      ) : (
        <>
          <button type="button" onClick={() => setPersonalizado(true)} className="inline-flex items-center gap-1.5 text-sm text-acento hover:underline px-1" data-alternar-periodo>
            <CalendarRange className="w-3.5 h-3.5" /> Período personalizado
          </button>
          {permitirTodos && (
            <button type="button" onClick={() => navegar({ mes: null, de: null, ate: null, periodo: "todos" })} className="inline-flex items-center gap-1.5 text-sm text-acento hover:underline px-1" data-todo-periodo>
              <Todos className="w-3.5 h-3.5" /> Todo o período
            </button>
          )}
        </>
      )}
      {periodo.tipo === "intervalo" && <span className="text-xs text-ink-muted" data-periodo-rotulo>{periodo.rotulo}</span>}
      {dica && <Dica texto={dica} rotulo="Período" />}
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
