"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InputHora } from "@/components/ui/input-hora";
import { toast } from "@/components/ui/avisos";
import { SomenteLeitura } from "@/components/config/permissao-config";
import { cn } from "@/lib/utils";
import {
  DIAS_DA_SEMANA, JORNADA_PADRAO, horarioComercialSchema, horarioDe, jornadaDe, rotuloDaJornada, type HorarioComercial,
} from "@/lib/atendimento/prazo";

/** A semana começa na segunda (como o expediente) */
const ORDEM = [1, 2, 3, 4, 5, 6, 0];
const nomeDoDia = (dia: number) => DIAS_DA_SEMANA[dia].charAt(0).toUpperCase() + DIAS_DA_SEMANA[dia].slice(1);

interface Linha { ativo: boolean; inicio: string; fim: string }
const paraLinhas = (h: HorarioComercial): Linha[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    const d = h.dias.find((x) => x.dia === dia);
    return d ? { ativo: true, inicio: d.inicio, fim: d.fim } : { ativo: false, inicio: "08:00", fim: "18:00" };
  });
const paraHorario = (linhas: Linha[]): HorarioComercial => ({ dias: linhas.flatMap((l, dia) => (l.ativo ? [{ dia, inicio: l.inicio, fim: l.fim }] : [])) });

/**
 * HORÁRIO COMERCIAL da empresa: em cada dia da semana, se há expediente e de que hora a que hora.
 * É o que "contar só em horário comercial" usa no prazo de atendimento dos contratos. Salvou: toast.
 * Sem Configurações › gerenciar: só leitura.
 */
export function HorarioComercialClient({ inicial, podeEditar }: { inicial: HorarioComercial; podeEditar: boolean }) {
  const [linhas, setLinhas] = useState<Linha[]>(() => paraLinhas(inicial));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const mudar = (dia: number, parte: Partial<Linha>) => { setLinhas((l) => l.map((x, i) => (i === dia ? { ...x, ...parte } : x))); setMsg(null); };
  const lido = horarioComercialSchema.safeParse(paraHorario(linhas));

  async function salvar() {
    if (!lido.success) { setMsg(lido.error.issues[0]?.message ?? "Horário comercial inválido."); return; }
    setSalvando(true); setMsg(null);
    try {
      const r = await fetch("/api/configuracoes/horario-comercial", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lido.data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.erro ?? "Não foi possível salvar."); return; }
      toast("Horário comercial salvo. Vale para os prazos de atendimento calculados daqui em diante.");
    } catch {
      setMsg("Sem conexão. Tente de novo.");
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4" data-horario-comercial-config>
      <div className="card overflow-hidden">
        <ul className="divide-y divide-surface-border">
          {ORDEM.map((dia) => {
            const l = linhas[dia];
            return (
              <li key={dia} data-dia={dia} className={cn("px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2", !l.ativo && "bg-surface-alt/40")}>
                <div className="flex items-center gap-3 w-36 shrink-0">
                  <button
                    type="button" role="switch" aria-checked={l.ativo} aria-label={`Expediente — ${DIAS_DA_SEMANA[dia]}`} disabled={!podeEditar}
                    onClick={() => mudar(dia, { ativo: !l.ativo })}
                    className={cn("relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors disabled:opacity-60", l.ativo ? "bg-success-500" : "bg-surface-border")}
                  >
                    <span className={cn("inline-block h-[18px] w-[18px] mt-[2px] rounded-full bg-white shadow transition-transform", l.ativo ? "translate-x-[20px]" : "translate-x-[2px]")} />
                  </button>
                  <span className="text-sm font-medium text-ink">{nomeDoDia(dia)}</span>
                </div>
                {l.ativo ? (
                  <div className="flex items-center gap-2 text-sm text-ink-muted">
                    <span>das</span>
                    <InputHora aria-label={`Início do expediente — ${DIAS_DA_SEMANA[dia]}`} value={l.inicio} onChange={(h) => mudar(dia, { inicio: h })} disabled={!podeEditar} className="w-24" />
                    <span>às</span>
                    <InputHora aria-label={`Fim do expediente — ${DIAS_DA_SEMANA[dia]}`} value={l.fim} onChange={(h) => mudar(dia, { fim: h })} disabled={!podeEditar} className="w-24" />
                  </div>
                ) : (
                  <span className="text-sm text-ink-muted">Sem expediente</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-sm text-ink-muted" data-resumo-horario>
        {lido.success ? <>Horário comercial: <strong className="text-ink">{rotuloDaJornada(jornadaDe(lido.data))}</strong>.</> : "Complete os horários para salvar."}
        {" "}Os prazos já gravados nas OS não mudam.
      </p>

      {msg && <p role="alert" className="text-sm font-medium text-atrasado" data-erro-horario>{msg}</p>}
      {podeEditar ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => { setLinhas(paraLinhas(horarioDe(JORNADA_PADRAO))); setMsg(null); }}>Restaurar padrão</Button>
          <Button type="button" onClick={salvar} loading={salvando} data-salvar-horario>Salvar</Button>
        </div>
      ) : (
        <SomenteLeitura />
      )}
    </div>
  );
}
