"use client";

import { useEffect, useMemo, useState } from "react";
import { Dica } from "@/components/ui/dica";
import { PilulaComportamento } from "@/components/estoque/categoria-produto";
import { comportamentoDoProduto, LABEL_COMPORTAMENTO } from "@/lib/estoque/categoria";
import { custoDosMateriais, type MaterialEfetivo, type ProdutoDaComposicao } from "@/lib/estoque/composicao";
import { formatarQtd } from "@/lib/estoque/regras";
import { formatarMoeda } from "@/lib/utils";

/**
 * Peças compartilhadas da composição (E3.2): o kit e a seção "Materiais padrão" do serviço usam o mesmo
 * custo de referência (GET /api/estoque/custos) e o mesmo resumo.
 */

/** Último custo de compra dos produtos (Map produtoId → custo); busca de novo só quando a lista de ids muda. */
export function useCustosProdutos(ids: readonly string[]) {
  const chave = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const [custos, setCustos] = useState<Map<string, number>>(new Map());
  const [carregando, setCarregando] = useState(false);
  useEffect(() => {
    if (!chave) { setCustos(new Map()); return; }
    let vivo = true;
    setCarregando(true);
    fetch(`/api/estoque/custos?ids=${encodeURIComponent(chave)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.custos) setCustos(new Map(Object.entries(d.custos as Record<string, number>).map(([k, v]) => [k, Number(v)]))); })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [chave]);
  return { custos, carregando };
}

/** Rótulo "Peça · Venda à parte"/"Material · Incluso" de um produto da composição (pela categoria) */
export function ComportamentoDoProduto({ produto, override }: { produto: ProdutoDaComposicao | null | undefined; override?: string | null }) {
  const c = override === "VENDA_A_PARTE" || override === "INCLUSO_NO_SERVICO" ? override : comportamentoDoProduto(produto);
  return <PilulaComportamento comportamento={c} className={override ? "ring-1 ring-acento/40" : undefined} />;
}

/** Linha "custo × quantidade" de um material (ou "sem custo" quando nunca comprado com custo) */
export function CustoDoMaterial({ produtoId, quantidade, custos }: { produtoId: string; quantidade: number; custos: ReadonlyMap<string, number> }) {
  const c = custos.get(produtoId);
  if (c == null) return <span className="text-[11px] text-ink-subtle italic whitespace-nowrap" data-sem-custo>sem custo de compra</span>;
  return <span className="text-xs tabular-nums text-ink-muted whitespace-nowrap" title={`${formatarMoeda(c)} × ${formatarQtd(quantidade)}`}>{formatarMoeda(c * quantidade)}</span>;
}

/**
 * Ajuda de precificação: custo somado dos materiais INCLUSOS (o que sai do bolso sem cobrar à parte) e, como
 * referência, dos cobrados à parte. Só informativo: não mexe no preço do serviço.
 */
export function ResumoCustoMateriais({ materiais, custos, carregando }: { materiais: readonly MaterialEfetivo[]; custos: ReadonlyMap<string, number>; carregando?: boolean }) {
  if (!materiais.length) return null;
  const r = custoDosMateriais(materiais, custos);
  const aParte = materiais.filter((m) => m.comportamento === "VENDA_A_PARTE").length;
  return (
    <div className="rounded-lg border border-surface-border bg-surface-page px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1" data-resumo-custo data-inclusos={r.inclusos} data-a-parte={r.aParte}>
      <span className="flex items-center gap-1">
        <span className="text-ink-muted">Custo dos materiais inclusos:</span>{" "}
        <strong className="tabular-nums" data-custo-inclusos>{carregando && !custos.size ? "…" : formatarMoeda(r.inclusos)}</strong>
        <Dica rotulo="Custo dos materiais inclusos" texto={`Soma do último custo de compra × quantidade dos materiais “${LABEL_COMPORTAMENTO.INCLUSO_NO_SERVICO}”: o que sai do bolso em cada serviço sem ser cobrado à parte. Serve para ter noção da margem; não altera o preço do serviço.`} />
      </span>
      {aParte > 0 && (
        <span className="text-ink-muted">
          Peças cobradas à parte: <span className="tabular-nums" data-custo-a-parte>{formatarMoeda(r.aParte)}</span> ({aParte} {aParte === 1 ? "item" : "itens"})
        </span>
      )}
      {r.semCusto.length > 0 && (
        <span className="text-[11px] text-atencao-texto" data-sem-custo-total={r.semCusto.length}>
          {r.semCusto.length === 1 ? "1 produto sem custo de compra" : `${r.semCusto.length} produtos sem custo de compra`} (soma incompleta)
        </span>
      )}
    </div>
  );
}
