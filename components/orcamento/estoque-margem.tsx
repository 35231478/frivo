"use client";

/**
 * Orçamento, leva B — o que o Editar orçamento mostra de estoque e margem (regras em lib/orcamentos/estoque-margem):
 *  - por produto/material: "Disponível N un" (só com o módulo Estoque ligado) e, se a quantidade passa do disponível,
 *    "faltam N" em tom de atenção — discreto, não bloqueia;
 *  - por produto (só com "Orçamentos › Ver custo e margem"): custo, lucro e margem da linha;
 *  - no fim: o resumo de custo, lucro bruto e margem do orçamento.
 * Tudo numa linha que QUEBRA (flex-wrap): no celular desce para baixo da linha, sem rolagem horizontal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { cn, formatarMoeda } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";
import { formatarPct } from "@/lib/estoque/preco";
import { faltaNoEstoque, margemDoItem, tomDaMargem, type ResumoMargem, type SituacaoProduto } from "@/lib/orcamentos/estoque-margem";

export interface SituacaoTela {
  estoque: boolean;
  verCusto: boolean;
  produtos: Record<string, SituacaoProduto>;
}

const COR_TOM = { atrasado: "text-atrasado-texto", atencao: "text-atencao-texto", ok: "text-ok-texto", neutro: "text-ink-muted" } as const;

/**
 * Disponível e custo dos produtos do orçamento, da rota do servidor (que decide o que pode vir). Pede de novo quando
 * o conjunto de produtos muda (com uma pequena espera, para não chamar a cada tecla).
 */
export function useSituacaoProdutos(ids: readonly string[]): SituacaoTela | null {
  const chave = useMemo(() => [...new Set(ids.filter(Boolean))].sort().join(","), [ids]);
  const [estado, setEstado] = useState<SituacaoTela | null>(null);
  const pedido = useRef(0);
  useEffect(() => {
    if (!chave) { setEstado((e) => (e ? { ...e, produtos: {} } : e)); return; }
    const meu = ++pedido.current;
    const t = setTimeout(() => {
      fetch(`/api/orcamentos/situacao-produtos?ids=${encodeURIComponent(chave)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && meu === pedido.current) setEstado({ estoque: !!d.estoque, verCusto: !!d.verCusto, produtos: d.produtos ?? {} }); })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [chave]);
  return estado;
}

/** "Disponível 4 un" e, se não cobre, "faltam 2" em atenção. Sem o dado (Estoque desligado / produto sem controle): nada. */
export function Disponivel({ quantidade, situacao, compacto = false }: { quantidade: unknown; situacao?: SituacaoProduto | null; compacto?: boolean }) {
  if (!situacao || situacao.disponivel === undefined || situacao.disponivel === null) return null;
  const falta = faltaNoEstoque(quantidade, situacao.disponivel) ?? 0;
  const un = situacao.unidade ? ` ${situacao.unidade}` : "";
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap tabular-nums", falta > 0 ? "text-atencao-texto" : "text-ink-muted")}
      data-disponivel={situacao.disponivel} data-falta={falta > 0 ? falta : undefined}>
      {falta > 0 && <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />}
      {compacto ? "Disp." : "Disponível"} {formatarQtd(situacao.disponivel)}{un}
      {falta > 0 && <> · faltam {formatarQtd(falta)}</>}
    </span>
  );
}

/** Custo, lucro e margem de uma linha (só renderizado para quem tem a permissão). */
export function CustoMargemLinha({ venda, custoUnit, quantidade }: { venda: number; custoUnit: number | null | undefined; quantidade: unknown }) {
  if (custoUnit === undefined) return null;
  const m = margemDoItem(venda, custoUnit, quantidade);
  if (!m) return <span className="text-ink-subtle whitespace-nowrap" data-sem-custo>Sem custo de compra</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 tabular-nums" data-custo-linha={m.custo}>
      <span className="text-ink-muted whitespace-nowrap">Custo {formatarMoeda(m.custo)}</span>
      <span className="text-ink-muted whitespace-nowrap">Lucro <span className={COR_TOM[tomDaMargem(m.margem)]}>{formatarMoeda(m.lucro)}</span></span>
      <span className={cn("whitespace-nowrap font-semibold", COR_TOM[tomDaMargem(m.margem)])} data-margem-linha={m.margem == null ? "" : m.margem.toFixed(1)}>Margem {formatarPct(m.margem)}</span>
    </span>
  );
}

/** A linha de informação sob o produto: disponível (Estoque) e, com a permissão, custo/lucro/margem. */
export function InfoProduto({ quantidade, venda, situacao, custoUnit, verCusto }: {
  quantidade: unknown; venda: number; situacao?: SituacaoProduto | null;
  /** Custo unitário desta linha (peça: o copiado no material; produto: o último custo de compra). undefined = sem permissão */
  custoUnit?: number | null; verCusto: boolean;
}) {
  const disp = <Disponivel quantidade={quantidade} situacao={situacao} />;
  const temDisp = !!situacao && situacao.disponivel !== undefined && situacao.disponivel !== null;
  const temCusto = verCusto && custoUnit !== undefined;
  if (!temDisp && !temCusto) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 pb-1.5 -mt-0.5 text-[11px]" data-info-produto>
      {disp}
      {temCusto && <CustoMargemLinha venda={venda} custoUnit={custoUnit} quantidade={quantidade} />}
    </div>
  );
}

/** O resumo de custo e margem do orçamento (no bloco de totais; só para quem tem a permissão). */
export function ResumoCustoMargem({ resumo }: { resumo: ResumoMargem }) {
  const tom = tomDaMargem(resumo.margem);
  return (
    <section className="space-y-2 pt-3 border-t border-surface-border" aria-label="Custo e margem" data-resumo-margem>
      <h4 className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
        Custo e margem
        <Dica rotulo="Custo e margem" lado="direita" texto="Só para quem tem permissão; nunca vai ao cliente. Custo = último custo de compra dos produtos, peças e materiais inclusos. Lucro bruto = total do orçamento sem o ISS − esse custo. Mão de obra e impostos não entram. Margem sobre a venda, como no Estoque." />
      </h4>
      <div className="flex justify-between gap-3 text-sm"><span className="text-ink-muted">Custo (produtos e materiais)</span><span className="tabular-nums" data-valor="custo-total">{formatarMoeda(resumo.custo)}</span></div>
      <div className="flex justify-between gap-3 text-sm"><span className="text-ink-muted">Lucro bruto</span><span className={cn("tabular-nums font-semibold", COR_TOM[tom])} data-valor="lucro-total">{formatarMoeda(resumo.lucro)}</span></div>
      <div className="flex justify-between gap-3 text-sm"><span className="text-ink-muted">Margem</span><span className={cn("tabular-nums font-bold", COR_TOM[tom])} data-valor="margem-total">{formatarPct(resumo.margem)}</span></div>
      {resumo.semCusto > 0 && (
        <p className="flex items-center gap-1 text-[11px] text-atencao-texto" data-itens-sem-custo={resumo.semCusto}>
          <AlertTriangle className="w-3 h-3" aria-hidden /> {resumo.semCusto} {resumo.semCusto === 1 ? "item sem custo de compra (fora da conta)" : "itens sem custo de compra (fora da conta)"}
        </p>
      )}
    </section>
  );
}
