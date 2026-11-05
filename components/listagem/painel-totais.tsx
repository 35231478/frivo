"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn, formatarMoeda } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";

export interface LinhaTotal {
  chave: string;
  rotulo: string;
  v: number;
  q?: number;
  /** Cor do valor (classe de texto da paleta) — ex.: text-atrasado nos vencidos */
  cor?: string;
  dica?: string;
}

/**
 * Painel de totais no rodapé da lista (padrão do Conta Azul): abre/fecha pela setinha e mostra
 *  - sem seleção: os totais do PERÍODO (a mesma quebra dos cards de cima), com o total em destaque;
 *  - com linhas marcadas: "Total dos N selecionados" e a mesma quebra, só do que está marcado —
 *    recalculado a cada marca/desmarca (o cálculo é da tela: lib/listagem/totais-selecao).
 * Responsivo: título e destaque empilham no celular; as linhas da quebra ficam em 2 colunas.
 */
export function PainelTotais({ periodo, selecao, unidade, abertoInicial = true, className, extra }: {
  periodo: { rotulo: string; subtitulo?: string; total: LinhaTotal; linhas: LinhaTotal[] };
  /** Null/0 = sem seleção (mostra o período). `naPagina` < `n` quando parte da seleção não está nesta página */
  selecao?: { n: number; naPagina?: number; total: LinhaTotal; linhas: LinhaTotal[] } | null;
  /** ["cobrança", "cobranças"] para as quantidades */
  unidade: [string, string];
  abertoInicial?: boolean;
  className?: string;
  /** Algo a mais na linha de cima (ex.: um aviso) */
  extra?: ReactNode;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  const comSelecao = !!selecao && selecao.n > 0;
  const total = comSelecao ? selecao!.total : periodo.total;
  const linhas = comSelecao ? selecao!.linhas : periodo.linhas;
  const n = selecao?.n ?? 0;
  const naPagina = selecao?.naPagina ?? n;
  const tituloSelecao = `Total dos ${n} ${n === 1 ? unidade[0].replace(/^\w/, (c) => c.toLowerCase()) : unidade[1]} selecionad${unidade[0].endsWith("a") ? (n === 1 ? "a" : "as") : (n === 1 ? "o" : "os")}`;
  const qtd = (q?: number) => (q == null ? null : `${q} ${q === 1 ? unidade[0] : unidade[1]}`);
  return (
    <section className={cn("border-t border-surface-border bg-surface-alt/40", className)} data-painel-totais data-modo={comSelecao ? "selecao" : "periodo"} aria-label="Totais">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink" data-painel-titulo>{comSelecao ? tituloSelecao : "Totais do período"}</h3>
          <p className="text-xs text-ink-muted" data-painel-subtitulo>
            {comSelecao
              ? (naPagina < n ? `${naPagina} nesta página: a soma é só delas` : "Só do que está marcado")
              : (periodo.subtitulo ?? periodo.rotulo)}
          </p>
          {extra}
        </div>
        <div className="flex items-start gap-2 shrink-0 text-right">
          <div>
            <p className="text-xs text-ink-muted whitespace-nowrap">{total.rotulo} (R$)</p>
            <p className="text-base font-bold text-ink tabular-nums" data-painel-total>{formatarMoeda(total.v)}</p>
          </div>
          <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} aria-controls="painel-totais-quebra"
            className="p-1.5 -mr-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt" title={aberto ? "Recolher" : "Ver a quebra"} data-painel-alternar>
            <ChevronDown className={cn("w-4 h-4 transition-transform", aberto && "rotate-180")} />
          </button>
        </div>
      </div>
      {aberto && (
        <dl id="painel-totais-quebra" className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 px-4 pb-3" data-painel-quebra>
          {linhas.map((l) => (
            <div key={l.chave} className="flex items-baseline justify-between gap-3 text-sm" data-painel-linha={l.chave}>
              <dt className="flex items-center gap-1 text-ink-muted min-w-0">
                <span className="truncate">{l.rotulo} (R$)</span>
                {l.dica && <Dica texto={l.dica} rotulo={l.rotulo} />}
              </dt>
              <dd className="text-right whitespace-nowrap">
                <span className={cn("font-semibold tabular-nums", l.cor ?? "text-ink")} data-painel-valor>{formatarMoeda(l.v)}</span>
                {l.q != null && <span className="ml-1.5 text-[11px] text-ink-subtle" data-painel-qtd>{qtd(l.q)}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
