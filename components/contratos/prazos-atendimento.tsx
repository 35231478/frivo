"use client";

import { Input } from "@/components/ui/input";
import { LABELS_PRIORIDADE } from "@/lib/utils";
import { PRIORIDADES, type PrioridadeOs } from "@/lib/atendimento/prazo";
import { abrirPorPrioridade, voltarAoPrazoUnico, type HorasDigitadas, type PrazosDoFormulario } from "@/lib/atendimento/formulario";

export const DICA_PRAZO_ATENDIMENTO = "O que este contrato promete ao cliente quando ele abre um chamado: em quantas horas o técnico comparece e em quantas o chamado é resolvido. Conta da hora em que o cliente abriu o chamado. Deixe em branco o que o contrato não promete. É diferente do prazo de execução da OS, que é o compromisso interno com a equipe.";

/**
 * PRAZO DE ATENDIMENTO do contrato. Começa simples — um prazo para todo chamado — e abre "por
 * prioridade" para quem precisa prometer tempos diferentes. `horario`: o horário comercial da
 * empresa, dito por extenso (vem de Configurações › Horário comercial).
 */
export function PrazosAtendimento({ value, onChange, horario, erro }: {
  value: PrazosDoFormulario; onChange: (v: PrazosDoFormulario) => void; horario: string; erro?: string;
}) {
  const mudarGeral = (campo: keyof HorasDigitadas, texto: string) => onChange({ ...value, geral: { ...value.geral, [campo]: texto } });
  const mudarLinha = (p: PrioridadeOs, campo: keyof HorasDigitadas, texto: string) =>
    onChange({ ...value, linhas: { ...value.linhas, [p]: { ...value.linhas[p], [campo]: texto } } });

  return (
    <div className="space-y-3" data-prazos-atendimento={value.porPrioridade ? "por-prioridade" : "unico"}>
      {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-prazos-atendimento>{erro}</p>}

      {!value.porPrioridade ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <CampoHoras rotulo="Comparecer em" nome="Comparecer em (horas)" valor={value.geral.comparecer} aoMudar={(t) => mudarGeral("comparecer", t)} dado="comparecer" />
          <CampoHoras rotulo="Resolver em" nome="Resolver em (horas)" valor={value.geral.resolver} aoMudar={(t) => mudarGeral("resolver", t)} dado="resolver" />
        </div>
      ) : (
        <div className="max-w-xl" data-prazos-por-prioridade>
          <div className="hidden sm:grid grid-cols-[8rem_1fr_1fr] gap-x-4 pb-1.5 text-xs font-medium text-ink-muted">
            <span>Prioridade do chamado</span><span>Comparecer em</span><span>Resolver em</span>
          </div>
          <ul className="divide-y divide-surface-border border-y border-surface-border">
            {PRIORIDADES.map((p) => (
              <li key={p} className="grid grid-cols-2 sm:grid-cols-[8rem_1fr_1fr] gap-x-4 gap-y-1.5 py-2.5 items-center" data-prazo-prioridade={p}>
                <span className="col-span-2 sm:col-span-1 text-sm font-medium text-ink">{LABELS_PRIORIDADE[p]}</span>
                <CampoHoras rotuloCelular="Comparecer em" nome={`Comparecer em (horas), prioridade ${LABELS_PRIORIDADE[p]}`} valor={value.linhas[p].comparecer} aoMudar={(t) => mudarLinha(p, "comparecer", t)} dado="comparecer" />
                <CampoHoras rotuloCelular="Resolver em" nome={`Resolver em (horas), prioridade ${LABELS_PRIORIDADE[p]}`} valor={value.linhas[p].resolver} aoMudar={(t) => mudarLinha(p, "resolver", t)} dado="resolver" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-ink cursor-pointer max-w-xl">
        <input type="checkbox" checked={value.soHorarioComercial} onChange={(e) => onChange({ ...value, soHorarioComercial: e.target.checked })}
          className="mt-0.5 w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" data-so-horario-comercial />
        <span>
          Contar só em horário comercial
          <span className="block text-xs text-ink-muted" data-horario-comercial>{horario}. Fora desse horário o relógio do prazo para.</span>
        </span>
      </label>

      <button type="button" className="text-xs font-medium text-acento hover:underline" data-alternar-prioridade
        onClick={() => onChange(value.porPrioridade ? voltarAoPrazoUnico(value) : abrirPorPrioridade(value))}>
        {value.porPrioridade ? "Usar um prazo só para todo chamado" : "Definir por prioridade do chamado"}
      </button>
    </div>
  );
}

function CampoHoras({ rotulo, rotuloCelular, nome, valor, aoMudar, dado }: {
  rotulo?: string; rotuloCelular?: string; nome: string; valor: string; aoMudar: (t: string) => void; dado: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {rotulo && <span className="text-sm font-medium text-ink">{rotulo}</span>}
      {rotuloCelular && <span className="sm:hidden text-xs text-ink-muted">{rotuloCelular}</span>}
      <span className="flex items-center gap-2">
        <Input inputMode="numeric" value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder="Sem prazo" aria-label={nome} className="w-full" data-horas={dado} />
        <span className="text-sm text-ink-muted shrink-0">horas</span>
      </span>
    </label>
  );
}
