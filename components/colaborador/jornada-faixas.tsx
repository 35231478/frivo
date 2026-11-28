"use client";

import { Clock, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { InputHora } from "@/components/ui/input-hora";
import { Button } from "@/components/ui/button";
import {
  DIAS_SEMANA, FAIXAS_MAX, ROTULO_DIA, faixaNova, horasDaJornada, minutosDaFaixa, ordenarDias, problemasDaJornada, textoHoras,
  type DiaSemana, type FaixaJornada,
} from "@/lib/colaborador/jornada";

/**
 * A JORNADA em faixas (Leva J): cada faixa com os seus dias, a entrada, a saída e o intervalo. Um dia não pode estar
 * em duas faixas (o dia que já é de outra faixa aparece apagado, com o número dela). O contador de horas por dia e
 * por semana é calculado ao vivo, descontando o intervalo.
 */
export function JornadaFaixas({ faixas, onChange, disabled = false }: { faixas: FaixaJornada[]; onChange: (f: FaixaJornada[]) => void; disabled?: boolean }) {
  const problemas = problemasDaJornada(faixas);
  const { porDia, semana } = horasDaJornada(faixas);
  const donoDoDia = (d: DiaSemana) => faixas.findIndex((f) => f.dias.includes(d));
  const mudar = (i: number, p: Partial<FaixaJornada>) => onChange(faixas.map((f, j) => (j === i ? { ...f, ...p } : f)));

  function alternarDia(i: number, d: DiaSemana) {
    const f = faixas[i];
    mudar(i, { dias: f.dias.includes(d) ? f.dias.filter((x) => x !== d) : ordenarDias([...f.dias, d]) });
  }

  return (
    <div className="space-y-3" data-jornada-faixas>
      {faixas.length === 0 && <p className="text-sm text-ink-muted" data-jornada-vazia>Sem jornada definida.</p>}
      {faixas.map((f, i) => {
        const min = minutosDaFaixa(f);
        const erros = problemas.faixas[i] ?? [];
        return (
          <div key={i} className={cn("rounded-card border p-3 sm:p-4 space-y-3", erros.length ? "border-atrasado/40" : "border-surface-border")} data-faixa={i}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Faixa {i + 1}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted" data-horas-faixa>{min !== null ? `${textoHoras(min)} por dia` : "—"}</span>
                {!disabled && (
                  <button type="button" onClick={() => onChange(faixas.filter((_, j) => j !== i))} aria-label={`Excluir a faixa ${i + 1}`}
                    className="p-2 -m-1 rounded-lg text-ink-muted hover:text-atrasado hover:bg-atrasado-claro min-w-[36px] min-h-[36px] inline-flex items-center justify-center" data-remover-faixa>
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Dias da faixa ${i + 1}`}>
              {DIAS_SEMANA.map((d) => {
                const sel = f.dias.includes(d);
                const dono = donoDoDia(d);
                const deOutra = !sel && dono !== -1 && dono !== i;
                return (
                  <button key={d} type="button" disabled={disabled || deOutra} onClick={() => alternarDia(i, d)} aria-pressed={sel}
                    title={deOutra ? `Já está na faixa ${dono + 1}` : undefined} data-dia={d}
                    className={cn(
                      "min-w-[44px] min-h-[36px] px-2.5 rounded-lg text-sm font-medium border transition-colors",
                      sel ? "bg-primary-500 border-primary-500 text-white" : deOutra ? "bg-surface-page border-surface-border text-ink-subtle line-through cursor-not-allowed" : "bg-white border-surface-border text-ink-muted hover:border-primary-300",
                    )}>
                    {ROTULO_DIA[d]}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-xs text-ink-muted space-y-1"><span>Entrada</span>
                <InputHora value={f.entrada} onChange={(v) => mudar(i, { entrada: v })} aria-label={`Entrada da faixa ${i + 1}`} disabled={disabled} />
              </label>
              <label className="text-xs text-ink-muted space-y-1"><span>Saída</span>
                <InputHora value={f.saida} onChange={(v) => mudar(i, { saida: v })} aria-label={`Saída da faixa ${i + 1}`} disabled={disabled} />
              </label>
              <label className="text-xs text-ink-muted space-y-1"><span>Intervalo: início</span>
                <InputHora value={f.intervaloInicio ?? ""} onChange={(v) => mudar(i, { intervaloInicio: v || null })} aria-label={`Início do intervalo da faixa ${i + 1}`} disabled={disabled} />
              </label>
              <label className="text-xs text-ink-muted space-y-1"><span>Intervalo: fim</span>
                <InputHora value={f.intervaloFim ?? ""} onChange={(v) => mudar(i, { intervaloFim: v || null })} aria-label={`Fim do intervalo da faixa ${i + 1}`} disabled={disabled} />
              </label>
            </div>
            {erros.length > 0 && <p role="alert" className="text-xs text-atrasado-texto" data-erro-faixa>{erros[0]}</p>}
          </div>
        );
      })}

      {!disabled && faixas.length < FAIXAS_MAX && (
        <Button type="button" variant="secondary" onClick={() => onChange([...faixas, faixaNova(faixas)])} data-adicionar-faixa>
          <Plus className="w-4 h-4" aria-hidden /> Adicionar faixa
        </Button>
      )}

      {/* O contador: horas de cada dia e da semana, descontando o intervalo */}
      <div className="rounded-card bg-surface-page px-3 py-2.5" data-contador-jornada>
        <p className="flex items-center gap-2 text-sm text-ink">
          <Clock className="w-4 h-4 text-ink-muted" aria-hidden />
          <span><strong data-horas-semana>{textoHoras(semana)}</strong> por semana</span>
        </p>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="text-[11px] leading-tight" data-horas-dia={d}>
              <span className="block text-ink-muted">{ROTULO_DIA[d]}</span>
              <span className={cn("block font-semibold", porDia[d] ? "text-ink" : "text-ink-subtle")}>{porDia[d] ? textoHoras(porDia[d]!) : "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
