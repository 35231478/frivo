"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import { competenciaAnterior, competenciaSeguinte, formatarEscore, rotuloCompetencia } from "@/lib/desempenho/regras";

export const JSON_HEADERS = { "Content-Type": "application/json" };

export type AbaDesempenho = "painel" | "revisao" | "premiacoes" | "configuracao";
export interface PodeDesempenho { revisar: boolean; gerenciar: boolean }

/** Título do módulo e as abas (cada uma é uma rota; só aparecem as que a pessoa pode abrir). */
export function CabecalhoDesempenho({ ativa, pode, aRevisar, acoes }: { ativa: AbaDesempenho; pode: PodeDesempenho; aRevisar?: number; acoes?: React.ReactNode }) {
  const abas: { id: AbaDesempenho; href: string; rotulo: string; mostrar: boolean; selo?: number }[] = [
    { id: "painel", href: "/desempenho", rotulo: "Painel", mostrar: true },
    { id: "revisao", href: "/desempenho/revisao", rotulo: "A revisar", mostrar: pode.revisar, selo: aRevisar },
    { id: "premiacoes", href: "/desempenho/premiacoes", rotulo: "Premiação", mostrar: true },
    { id: "configuracao", href: "/desempenho/configuracao", rotulo: "Configuração", mostrar: pode.gerenciar },
  ];
  return (
    <header className="space-y-3" data-cabecalho-desempenho>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Desempenho</h1>
          <p className="text-sm text-ink-muted mt-1">Índice de qualidade da manutenção, por colaborador e por mês.</p>
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      <nav className="flex gap-1 border-b border-surface-border overflow-x-auto" aria-label="Seções do módulo">
        {abas.filter((a) => a.mostrar).map((a) => (
          <Link key={a.id} href={a.href} data-aba={a.id} aria-current={a.id === ativa ? "page" : undefined}
            className={cn("px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-1.5",
              a.id === ativa ? "border-acento text-acento" : "border-transparent text-ink-muted hover:text-ink")}>
            {a.rotulo}
            {!!a.selo && <span className="rounded-full bg-atencao-claro text-atencao-texto text-[11px] px-1.5 py-0.5 tabular-nums" data-selo-revisar>{a.selo}</span>}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Mês anterior / seguinte. `max` = último mês que dá para abrir (o corrente). */
export function SeletorDeMes({ mes, aoMudar, max }: { mes: string; aoMudar: (mes: string) => void; max?: string }) {
  const noFim = !!max && mes >= max;
  const botao = "p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-white px-1 py-1" data-seletor-mes={mes}>
      <button type="button" className={botao} onClick={() => aoMudar(competenciaAnterior(mes))} aria-label="Mês anterior" data-mes-anterior><ChevronLeft className="w-4 h-4" /></button>
      <span className="text-sm font-medium text-ink min-w-[9.5rem] text-center first-letter:uppercase" data-mes-rotulo>{rotuloCompetencia(mes)}</span>
      <button type="button" className={botao} onClick={() => aoMudar(competenciaSeguinte(mes))} disabled={noFim} aria-label="Mês seguinte" data-mes-seguinte><ChevronRight className="w-4 h-4" /></button>
    </div>
  );
}

/** A faixa atingida — ou por que não há faixa (abaixo da meta, sem medição). */
export function SeloFaixa({ faixa, escore, atingiuMeta }: { faixa: string | null; escore: number | null; atingiuMeta: boolean }) {
  if (escore === null) return <StatusPill tom="previsto" tamanho="sm" data-faixa="sem-medicao">Sem medição</StatusPill>;
  if (!atingiuMeta) return <StatusPill tom="atrasado" tamanho="sm" data-faixa="abaixo-da-meta">Abaixo da meta</StatusPill>;
  if (!faixa) return <StatusPill tom="previsto" tamanho="sm" data-faixa="sem-faixa">Sem faixa</StatusPill>;
  return <StatusPill tom="ok" tamanho="sm" data-faixa={faixa}>{faixa}</StatusPill>;
}

/** O escore com uma barra de 0 a 100 e a marca da meta mínima. */
export function BarraEscore({ escore, meta, className }: { escore: number | null; meta?: number | null; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-2 flex-1 min-w-[4rem] rounded-full bg-surface-alt overflow-hidden" aria-hidden>
        {escore !== null && <div className={cn("h-full rounded-full", meta != null && escore < meta ? "bg-atrasado" : "bg-ok")} style={{ width: `${Math.max(0, Math.min(100, escore))}%` }} />}
        {meta != null && <span className="absolute top-0 bottom-0 w-px bg-ink/50" style={{ left: `${meta}%` }} />}
      </div>
      <span className="text-sm font-semibold text-ink tabular-nums w-14 text-right" data-escore>{formatarEscore(escore)}</span>
    </div>
  );
}

export const Erro = ({ texto, ...dados }: { texto: string } & Record<`data-${string}`, string | undefined>) => (
  texto ? <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" {...dados}>{texto}</p> : null
);

export const posicaoTexto = (posicao: number | null) => (posicao === null ? "—" : `${posicao}º`);

/** Lê a resposta de uma rota: os dados, ou a mensagem de erro que o servidor mandou. */
export async function lerResposta<T>(res: Response, padrao: string): Promise<{ ok: true; dados: T } | { ok: false; erro: string }> {
  const d = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, dados: d as T } : { ok: false, erro: (d as { erro?: string }).erro ?? padrao };
}
