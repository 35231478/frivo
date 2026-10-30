"use client";

import type { ComponentType } from "react";
import { CheckCircle2, Send, Sigma, ThumbsDown, TimerOff } from "lucide-react";
import { BarraPeriodo, CardResumo, GradeCards, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { useListaUrl } from "@/components/listagem/lista-url";

type CardKey = "EM_ABERTO" | "APROVADO" | "RECUSADO" | "VENCIDO" | "TOTAL";
/** Cards de funil do período (lib/listas/filtros: CARDS_PERIODO_ORCAMENTOS): quantidade + R$ */
export type ResumoOrcamentos = Record<CardKey, { v: number; q: number }>;

const CARDS: { key: CardKey; rotulo: string; icone: ComponentType<{ className?: string }>; cor: string; dica: string }[] = [
  { key: "EM_ABERTO", rotulo: "Em aberto", icone: Send, cor: "text-acento", dica: "Enviados ao cliente e ainda na validade (vistos ou não), esperando resposta." },
  { key: "APROVADO", rotulo: "Aprovados", icone: CheckCircle2, cor: "text-success-600", dica: "Aprovados pelo cliente, inclusive os que já viraram contrato." },
  { key: "RECUSADO", rotulo: "Recusados", icone: ThumbsDown, cor: "text-atrasado", dica: "Recusados pelo cliente." },
  { key: "VENCIDO", rotulo: "Vencidos", icone: TimerOff, cor: "text-atencao-texto", dica: "Enviados que passaram da validade sem resposta." },
  { key: "TOTAL", rotulo: "Total do período", icone: Sigma, cor: "text-ink", dica: "Todos os orçamentos criados no período (rascunhos inclusive), menos os cancelados." },
];

/**
 * Orçamentos no padrão da casa (o mesmo de Contas a Receber/Pagar): período pela DATA DE CRIAÇÃO
 * e cards de funil do período, clicáveis como filtro. A lista é do servidor: isto só mexe na URL.
 */
export function PeriodoCardsOrcamentos({ periodo, resumo, card }: { periodo: PeriodoTela; resumo: ResumoOrcamentos; card: string }) {
  const { navegar } = useListaUrl();
  return (
    <>
      <BarraPeriodo periodo={periodo} navegar={navegar} permitirTodos dica="Pela data de criação do orçamento." />
      <GradeCards colunas={5}>
        {CARDS.map((c) => (
          <CardResumo key={c.key} id={c.key} rotulo={c.rotulo} icone={c.icone} cor={c.cor} dica={c.dica}
            v={resumo[c.key].v} q={resumo[c.key].q} unidade={["orçamento", "orçamentos"]}
            ativo={card === c.key} onClick={() => navegar({ card: card === c.key ? null : c.key })} />
        ))}
      </GradeCards>
    </>
  );
}

/** Nada no período: oferece todo o período (orçamento antigo, link de outra tela) */
export function VerTodoPeriodo() {
  const { navegar } = useListaUrl();
  return (
    <button type="button" onClick={() => navegar({ mes: null, de: null, ate: null, periodo: "todos" })} className="text-sm text-primary-600 hover:underline" data-ver-todo-periodo>
      Ver todo o período
    </button>
  );
}
