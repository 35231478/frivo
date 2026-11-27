"use client";

import { ChevronRight, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { irPara } from "@/components/tecnico/contexto";
import { useAgora } from "@/lib/ui/use-agora";
import { situacaoDoCartao } from "@/lib/tecnico/chegada";
import { situacaoAndamento, textoAlerta, type SituacaoAndamento } from "@/lib/tecnico/andamento";
import type { CartaoTela, OperacaoFila } from "@/lib/tecnico/offline/tipos";
import type { Jornada } from "@/lib/atendimento/prazo";

/** O que o aparelho sabe para avisar (vem da lista do dia ou do retrato) */
export interface DadosAndamento { limiteHoras: number; jornada: Jornada }

/** O início que vale no aparelho: o "iniciar" ainda na fila (hora do toque) ou o que o servidor mandou. */
export function inicioLocal(iniciadaEm: string | null | undefined, fila: OperacaoFila[], atividadeId: string): string | null {
  const op = fila.find((o) => o.atividadeId === atividadeId && o.tipo === "iniciar");
  return iniciadaEm ?? op?.em ?? op?.criadoEm ?? null;
}

/** Faixa de aviso: alto contraste, um toque abre a OS (no Meu dia). */
export function FaixaAndamento({ s, titulo, onAbrir, className }: { s: SituacaoAndamento; titulo?: string; onAbrir?: () => void; className?: string }) {
  const texto = textoAlerta(s);
  if (!texto) return null;
  const corpo = (
    <>
      <Timer className="w-6 h-6 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {titulo && <span className="block text-sm font-bold truncate">{titulo}</span>}
        <span className="block text-sm font-semibold">{texto}</span>
      </span>
      {onAbrir && <ChevronRight className="w-5 h-5 shrink-0" aria-hidden />}
    </>
  );
  const classe = cn("w-full text-left rounded-card bg-atencao text-white px-3 py-3 flex items-center gap-3 shadow-card", className);
  return onAbrir
    ? <button type="button" onClick={onAbrir} className={cn(classe, "touch-target")} data-aviso-andamento={s.alerta}>{corpo}</button>
    : <div role="status" className={classe} data-aviso-andamento={s.alerta}>{corpo}</div>;
}

/** Meu dia: as atividades em andamento que pedem atenção (passaram do limite, fim do expediente ou outro dia). */
export function AvisosDoDia({ cartoes, fila, andamento }: { cartoes: CartaoTela[]; fila: OperacaoFila[]; andamento: DadosAndamento | null | undefined }) {
  const agora = useAgora();
  if (!andamento) return null;
  const lista = cartoes.flatMap((c) => {
    const { status } = situacaoDoCartao(c, fila);
    const s = situacaoAndamento({ status, inicio: inicioLocal(c.iniciadaEm, fila, c.atividadeId), agora, limiteHoras: andamento.limiteHoras, jornada: andamento.jornada });
    return s.alerta ? [{ c, s }] : [];
  });
  if (!lista.length) return null;
  return (
    <section className="space-y-2" data-avisos-andamento>
      {lista.map(({ c, s }) => (
        <FaixaAndamento key={c.atividadeId} s={s} titulo={[c.osNumero, c.cliente || c.titulo].filter(Boolean).join(" · ")} onAbrir={() => irPara({ ver: "os", a: c.atividadeId })} />
      ))}
    </section>
  );
}
