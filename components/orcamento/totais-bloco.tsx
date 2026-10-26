"use client";

import { useEffect, useRef, useState } from "react";
import { formatarMoeda, cn } from "@/lib/utils";
import type { TipoDesconto } from "@prisma/client";
import { Landmark } from "lucide-react";
import type { TotaisOrcamento } from "@/lib/orcamentos/calculo";
import { lerNumeroBR } from "@/components/orcamento/itens-tabela";

export interface DescontoGrupoState { valor: number; tipo: TipoDesconto }

interface TotaisBlocoProps {
  /** Totais pelo cálculo único (lib/orcamentos/calculo.ts) — os mesmos que o servidor grava */
  totais: TotaisOrcamento;
  descontoServicos: DescontoGrupoState;
  descontoProdutos: DescontoGrupoState;
  onDescontoServicos: (d: DescontoGrupoState) => void;
  onDescontoProdutos: (d: DescontoGrupoState) => void;
  /** Alíquota da empresa hoje, quando difere da congelada neste orçamento (edição): oferece atualizar */
  issAliquotaEmpresa?: number;
  onUsarIssEmpresa?: () => void;
}

const pct = (v: number) => `${String(v).replace(".", ",")}%`;

/**
 * Totais do orçamento, na ordem do cálculo:
 * Serviços: subtotal → desconto → ISS (em destaque) → total com ISS; Produtos: subtotal → desconto → total;
 * TOTAL GERAL. O ISS aparece aqui (tela interna); no documento do cliente vem embutido nos preços.
 */
export function TotaisBloco({
  totais: t, descontoServicos, descontoProdutos, onDescontoServicos, onDescontoProdutos, issAliquotaEmpresa, onUsarIssEmpresa,
}: TotaisBlocoProps) {
  const issDiferente = issAliquotaEmpresa != null && issAliquotaEmpresa !== t.issAliquota;
  return (
    <div className="bg-surface-alt border border-surface-border rounded-card p-4 sm:p-5 space-y-4" data-totais-orcamento>
      <section className="space-y-2" aria-label="Serviços">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Serviços</h4>
        <Linha label="Subtotal serviços" valor={t.subtotalServicos} dado="subtotal-servicos" />
        <DescontoGrupo rotulo="Desconto serviços" estado={descontoServicos} onChange={onDescontoServicos} aplicado={t.descontoServicos} dado="desconto-servicos" />
        {t.issAliquota > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2" data-linha-iss>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-primary-700">
              <Landmark className="w-4 h-4" aria-hidden /> ISS ({pct(t.issAliquota)})
            </span>
            <span className="font-mono font-bold text-primary-700 tabular-nums" data-valor="iss">+ {formatarMoeda(t.valorIss)}</span>
          </div>
        ) : (
          <p className="text-xs text-ink-subtle" data-sem-iss>Sem ISS (alíquota 0% em Configurações).</p>
        )}
        {issDiferente && onUsarIssEmpresa && (
          <p className="text-xs text-atencao-texto" data-iss-diferente>
            Este orçamento usa ISS de {pct(t.issAliquota)}; a empresa hoje usa {pct(issAliquotaEmpresa!)}.{" "}
            <button type="button" onClick={onUsarIssEmpresa} className="font-semibold underline underline-offset-2 hover:text-ink">Usar {pct(issAliquotaEmpresa!)}</button>
          </p>
        )}
        <Linha label={t.issAliquota > 0 ? "Total serviços (com ISS)" : "Total serviços"} valor={t.totalServicos} bold dado="total-servicos" />
      </section>

      <section className="space-y-2 pt-3 border-t border-surface-border" aria-label="Produtos">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Produtos</h4>
        <Linha label="Subtotal produtos" valor={t.subtotalProdutos} dado="subtotal-produtos" />
        <DescontoGrupo rotulo="Desconto produtos" estado={descontoProdutos} onChange={onDescontoProdutos} aplicado={t.descontoProdutos} dado="desconto-produtos" />
        <Linha label="Total produtos" valor={t.totalProdutos} bold dado="total-produtos" />
      </section>

      <div className="pt-3 border-t-2 border-success-500/40 flex items-center justify-between gap-3">
        <span className="text-sm font-bold uppercase tracking-wider text-ink-muted">Total geral</span>
        <span className="text-2xl font-bold text-success-700 tabular-nums" data-valor="total-geral">{formatarMoeda(t.totalGeral)}</span>
      </div>
      {t.valorIss > 0 && (
        <p className="text-xs text-ink-muted">No documento do cliente o ISS vem embutido nos preços dos serviços (sem linha própria).</p>
      )}
    </div>
  );
}

function DescontoGrupo({ rotulo, estado, onChange, aplicado, dado }: {
  rotulo: string; estado: DescontoGrupoState; onChange: (d: DescontoGrupoState) => void; aplicado: number; dado: string;
}) {
  const [texto, setTexto] = useState(estado.valor ? String(estado.valor).replace(".", ",") : "");
  const focado = useRef(false);
  useEffect(() => { if (!focado.current) setTexto(estado.valor ? String(estado.valor).replace(".", ",") : ""); }, [estado.valor]);
  const limitado = estado.tipo === "PERCENTUAL" ? estado.valor > 100 : false;
  return (
    <div className="space-y-1" data-desconto-grupo={dado}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-muted" id={`rot-${dado}`}>{rotulo}</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={texto}
            placeholder="0"
            aria-labelledby={`rot-${dado}`}
            onFocus={() => { focado.current = true; }}
            onBlur={() => { focado.current = false; setTexto(estado.valor ? String(estado.valor).replace(".", ",") : ""); }}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.,]/g, "");
              setTexto(v);
              onChange({ ...estado, valor: Math.max(0, lerNumeroBR(v)) });
            }}
            className="w-24 bg-white border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-right text-ink tabular-nums focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15"
          />
          <div className="flex rounded-lg border border-surface-border overflow-hidden bg-white" role="group" aria-label={`Tipo do ${rotulo.toLowerCase()}`}>
            {(["VALOR", "PERCENTUAL"] as TipoDesconto[]).map((tipo) => (
              <button
                key={tipo}
                type="button"
                aria-pressed={estado.tipo === tipo}
                onClick={() => onChange({ ...estado, tipo })}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  tipo === "PERCENTUAL" && "border-l border-surface-border",
                  estado.tipo === tipo ? "bg-primary-500 text-white" : "text-ink-muted hover:bg-surface-alt",
                )}
              >
                {tipo === "VALOR" ? "R$" : "%"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {aplicado > 0 && (
        <div className="flex items-center justify-end text-sm">
          <span className="font-mono text-atrasado tabular-nums" data-valor={dado}>− {formatarMoeda(aplicado)}</span>
        </div>
      )}
      {limitado && <p className="text-xs text-atencao-texto">O desconto vai até 100%.</p>}
    </div>
  );
}

function Linha({ label, valor, bold, dado }: { label: string; valor: number; bold?: boolean; dado?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={cn("text-ink-muted", bold && "font-semibold text-ink")}>{label}</span>
      <span className={cn("font-mono tabular-nums", bold ? "font-bold text-ink" : "text-ink")} data-valor={dado}>
        {formatarMoeda(valor)}
      </span>
    </div>
  );
}
