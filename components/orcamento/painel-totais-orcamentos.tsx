"use client";

import { useMemo } from "react";
import { PainelTotais, type LinhaTotal } from "@/components/listagem/painel-totais";
import { useLinhasSelecionadas } from "@/components/listagem/selecao-linhas";
import { CHAVES_ORCAMENTOS, totaisOrcamentos, type OrcamentoSoma } from "@/lib/listagem/totais-selecao";
import type { PeriodoTela } from "@/lib/periodo";
import type { ResumoOrcamentos } from "@/components/orcamento/orcamentos-periodo";

/** Uma linha do painel de totais com o rótulo e a cor do card de funil correspondente */
const ROTULO_TOTAL: Record<string, { rotulo: string; cor?: string }> = {
  EM_ABERTO: { rotulo: "Em aberto", cor: "text-acento" }, APROVADO: { rotulo: "Aprovados", cor: "text-success-600" },
  RECUSADO: { rotulo: "Recusados", cor: "text-atrasado" }, VENCIDO: { rotulo: "Vencidos", cor: "text-atencao-texto" }, TOTAL: { rotulo: "Total" },
};
const linhaTotal = (chave: string, s: { v: number; q: number }): LinhaTotal => ({ chave, ...ROTULO_TOTAL[chave], v: s.v, q: s.q });

/**
 * Painel de totais da lista de orçamentos: o funil do período (os cards) ou só dos marcados. A
 * seleção é a das ações em massa (SelecaoMassaProvider), que atravessa páginas: a soma é dos
 * marcados DESTA página (o painel avisa quando há marcados fora dela).
 */
export function PainelTotaisOrcamentos({ itens, resumo, periodo }: {
  itens: (OrcamentoSoma & { id: string })[]; resumo: ResumoOrcamentos; periodo: PeriodoTela;
}) {
  const selecionados = useLinhasSelecionadas();
  const marcados = useMemo(() => itens.filter((o) => selecionados?.has(o.id)), [itens, selecionados]);
  const totais = useMemo(() => totaisOrcamentos(marcados), [marcados]);
  const quebra = (t: Record<string, { v: number; q: number }>) => CHAVES_ORCAMENTOS.filter((k) => k !== "TOTAL").map((k) => linhaTotal(k, t[k]));
  return (
    <>
      <PainelTotais unidade={["orçamento", "orçamentos"]}
        periodo={{ rotulo: periodo.rotulo, subtitulo: periodo.tipo === "todos" ? "Todo o período" : periodo.rotulo, total: linhaTotal("TOTAL", resumo.TOTAL), linhas: quebra(resumo) }}
        selecao={selecionados ? { n: selecionados.size, naPagina: marcados.length, total: linhaTotal("TOTAL", totais.TOTAL), linhas: quebra(totais) } : null}
      />
      {/* Com a barra de ações em massa na tela, um respiro no fim para o painel rolar acima dela */}
      {!!selecionados?.size && <div className="h-24 md:h-20" aria-hidden data-espaco-barra />}
    </>
  );
}
