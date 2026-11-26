"use client";

import { useState } from "react";
import { cn, formatarMoeda } from "@/lib/utils";
import { serieGrafico } from "@/lib/ui/tokens";
import { moedaCurta, montarSerie, rotuloAcessivelMes, type MesFinanceiro } from "@/lib/financeiro/grafico-meses";
import { Dica } from "@/components/ui/dica";

const AJUDA = "Entradas: o que foi recebido no mês (baixas das contas a receber). Saídas: o que foi pago no mês. Resultado: entradas menos saídas. Toque ou passe o mouse num mês para ver os valores.";

/**
 * Entradas × Saídas dos últimos meses — UM eixo, começando no zero, com os valores no eixo, o resultado
 * de cada mês escrito embaixo e o do período no cabeçalho. Cada mês é um alvo (mouse, toque ou teclado)
 * que mostra o detalhe; "Ver em tabela" dá os números exatos. Regras em lib/financeiro/grafico-meses.
 */
export function GraficoEntradasSaidas({ meses }: { meses: MesFinanceiro[] }) {
  const { barras, marcas, topo, resultadoPeriodo } = montarSerie(meses);
  const [ativo, setAtivo] = useState<string | null>(null);
  const indiceSel = barras.findIndex((b) => b.ref === ativo);
  const sel = indiceSel >= 0 ? barras[indiceSel] : null;

  return (
    <div className="card-padded" data-grafico-financeiro>
      <div className="flex items-start justify-between gap-x-4 gap-y-2 mb-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="card-title flex items-center gap-1.5">Entradas × Saídas <Dica rotulo="Entradas × Saídas" texto={AJUDA} /></h2>
          <p className="text-xs text-ink-muted mt-0.5">Últimos {barras.length} meses</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-muted">Resultado do período</p>
          <p className={cn("text-base font-bold tabular-nums", resultadoPeriodo < 0 ? "text-atrasado-texto" : "text-ink")} data-resultado-periodo>{formatarMoeda(resultadoPeriodo)}</p>
        </div>
      </div>

      {/* Legenda: a cor ao lado do nome; o texto na cor de texto */}
      <div className="flex items-center gap-4 text-xs text-ink-muted mb-3" data-legenda>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: serieGrafico.serie1 }} aria-hidden /> Entradas</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: serieGrafico.serie2 }} aria-hidden /> Saídas</span>
      </div>

      <div className="flex gap-2">
        {/* Eixo Y: as marcas redondas, do topo ao zero */}
        <div className="relative h-52 w-14 sm:w-16 shrink-0" data-eixo-y aria-hidden="true">
          {marcas.map((m) => (
            <span key={m} className="absolute right-0 -translate-y-1/2 text-[10px] sm:text-[11px] text-ink-muted tabular-nums whitespace-nowrap" style={{ top: `${100 - (m / topo) * 100}%` }}>
              {moedaCurta(m)}
            </span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0 h-52">
          {/* Grade recessiva; a linha do zero um pouco mais marcada */}
          {marcas.map((m) => (
            <div key={m} className={cn("absolute inset-x-0 border-t", m === 0 ? "border-surface-campo" : "border-surface-linha")} style={{ top: `${100 - (m / topo) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex" aria-hidden="true">
            {barras.map((b) => (
              <div key={b.ref} className="relative flex-1 flex items-end justify-center gap-0.5 px-1" data-mes={b.ref}>
                <div className="w-full max-w-[22px] rounded-t" style={{ height: `${b.altEntradas}%`, background: serieGrafico.serie1 }} data-barra="entradas" />
                <div className="w-full max-w-[22px] rounded-t" style={{ height: `${b.altSaidas}%`, background: serieGrafico.serie2 }} data-barra="saidas" />
                {ativo === b.ref && <div className="absolute inset-y-0 inset-x-0.5 bg-acento/5 rounded pointer-events-none" />}
              </div>
            ))}
          </div>
          {/* O detalhe do mês fica DENTRO do gráfico, no canto oposto ao mês: nunca sai do cartão nem cobre as barras dele */}
          {sel && (
            <div role="tooltip" data-detalhe-mes={sel.ref}
              className={cn("absolute top-0 z-20 w-48 max-w-[calc(100%-0.5rem)] rounded-lg border border-surface-border bg-white px-3 py-2 shadow-card-hover pointer-events-none",
                indiceSel < barras.length / 2 ? "right-0" : "left-0")}>
              <p className="text-xs font-semibold text-ink">{sel.nomeCompleto}</p>
              <Linha cor={serieGrafico.serie1} rotulo="Entradas" valor={sel.entradas} />
              <Linha cor={serieGrafico.serie2} rotulo="Saídas" valor={sel.saidas} />
              <p className="mt-1 pt-1 border-t border-surface-linha flex justify-between gap-2 text-xs">
                <span className="text-ink-muted">Resultado</span>
                <span className={cn("font-semibold tabular-nums", sel.resultado < 0 ? "text-atrasado-texto" : "text-ink")}>{formatarMoeda(sel.resultado)}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Meses: cada um é um alvo (mouse, toque e teclado) com o detalhe; embaixo, o resultado do mês */}
      <div className="flex gap-2">
        <div className="w-14 sm:w-16 shrink-0" />
        <div className="relative flex-1 min-w-0 flex">
          {barras.map((b) => (
            <button
              key={b.ref} type="button" data-mes-alvo={b.ref}
              onMouseEnter={() => setAtivo(b.ref)} onMouseLeave={() => setAtivo((a) => (a === b.ref ? null : a))}
              onFocus={() => setAtivo(b.ref)} onBlur={() => setAtivo((a) => (a === b.ref ? null : a))}
              // O toque emula o mouse (mouseenter antes do click): o clique sempre ABRE; fechar é sair, tocar fora ou outro mês
              onClick={() => setAtivo(b.ref)}
              aria-label={rotuloAcessivelMes(b, formatarMoeda)}
              className="relative flex-1 min-w-0 pt-1.5 pb-1 text-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-acento"
            >
              <span className="block text-[11px] text-ink-muted">{b.rotulo}</span>
              <span className={cn("block text-[10px] sm:text-[11px] font-medium tabular-nums whitespace-nowrap", b.resultado < 0 ? "text-atrasado-texto" : "text-ink")} data-resultado-mes>
                {/* No celular o mês tem ~50 px: sem o "R$" o rótulo cabe sem encostar no vizinho */}
                <span className="sm:hidden">{b.resultado > 0 ? "+" : ""}{moedaCurta(b.resultado, { prefixo: false })}</span>
                <span className="hidden sm:inline">{b.resultado > 0 ? "+" : ""}{moedaCurta(b.resultado)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <details className="mt-3 text-xs" data-tabela-grafico>
        <summary className="cursor-pointer text-acento font-semibold w-fit">Ver em tabela</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-muted text-left">
                <th className="font-medium py-1 pr-3">Mês</th>
                <th className="font-medium py-1 pr-3 text-right">Entradas</th>
                <th className="font-medium py-1 pr-3 text-right">Saídas</th>
                <th className="font-medium py-1 text-right">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {barras.map((b) => (
                <tr key={b.ref} className="border-t border-surface-linha">
                  <td className="py-1 pr-3">{b.nomeCompleto}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatarMoeda(b.entradas)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatarMoeda(b.saidas)}</td>
                  <td className={cn("py-1 text-right tabular-nums", b.resultado < 0 && "text-atrasado-texto")}>{formatarMoeda(b.resultado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Linha({ cor, rotulo, valor }: { cor: string; rotulo: string; valor: number }) {
  return (
    <p className="mt-1 flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-ink-muted"><span className="w-2 h-2 rounded-sm" style={{ background: cor }} aria-hidden />{rotulo}</span>
      <span className="font-medium text-ink tabular-nums">{formatarMoeda(valor)}</span>
    </p>
  );
}
