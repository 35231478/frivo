"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { proximasOcorrencias } from "@/lib/recorrencia-helpers";
import { FREQUENCIAS_RECORRENCIA, LABELS_PERIODICIDADE, formatarData } from "@/lib/utils";
import { MapPin, RefreshCw } from "lucide-react";

export interface LocalConfig {
  ativa: boolean;
  frequencia: string;
  tipoOsId: string;
  tecnicoId: string;
  dataPrimeiraOs: string;
}

interface Props {
  locais: { id: string; nome: string }[];
  tiposOs: { id: string; nome: string }[];
  tecnicos: { id: string; nome: string }[];
  value: Record<string, LocalConfig>;
  onChange: (unidadeId: string, patch: Partial<LocalConfig>) => void;
}

const cfgPadrao = (): LocalConfig => ({ ativa: false, frequencia: "MENSAL", tipoOsId: "", tecnicoId: "", dataPrimeiraOs: "" });

export function RecorrenciaLocais({ locais, tiposOs, tecnicos, value, onChange }: Props) {
  const [tick, setTick] = useState(0);

  if (locais.length === 0) {
    return <p className="text-sm text-ink-muted">Cadastre os locais cobertos primeiro na aba <strong>Locais cobertos</strong>.</p>;
  }

  return (
    <div className="space-y-3" data-tick={tick}>
      {locais.map((l) => {
        const c = value[l.id] ?? cfgPadrao();
        const base = c.dataPrimeiraOs ? new Date(`${c.dataPrimeiraOs}T12:00:00`) : null;
        const preview = (c.ativa && c.frequencia && base)
          ? proximasOcorrencias({ dataInicio: base, frequencia: c.frequencia, diaRecorrencia: base.getDate(), limite: 6, aPartirDe: base })
          : [];
        const tipoNome = tiposOs.find((t) => t.id === c.tipoOsId)?.nome ?? "Atendimento recorrente";
        const respNome = tecnicos.find((t) => t.id === c.tecnicoId)?.nome ?? "—";
        return (
          <div key={l.id} className="border border-surface-border rounded-xl p-4 space-y-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink"><MapPin className="w-4 h-4 text-primary-600" /> {l.nome}</span>
            <ToggleSwitch
              label="Ativar recorrência para este local"
              description="Gera ordens de serviço automaticamente para este endereço."
              checked={c.ativa}
              onChange={(v) => onChange(l.id, { ativa: v })}
            />
            {c.ativa && (
              <div className="space-y-4 border-l-2 border-primary-200 pl-4">
                <FormGrid cols={2}>
                  <FormField label="Frequência">
                    <Select value={c.frequencia} onChange={(e) => onChange(l.id, { frequencia: e.target.value })}>
                      {FREQUENCIAS_RECORRENCIA.map((f) => (<option key={f} value={f}>{LABELS_PERIODICIDADE[f]}</option>))}
                    </Select>
                  </FormField>
                  <FormField label="Data da primeira OS">
                    <Input type="date" value={c.dataPrimeiraOs} onChange={(e) => onChange(l.id, { dataPrimeiraOs: e.target.value })} />
                  </FormField>
                </FormGrid>
                <FormGrid cols={2}>
                  <FormField label="Tipo de OS">
                    <Select value={c.tipoOsId} onChange={(e) => onChange(l.id, { tipoOsId: e.target.value })} placeholder="Selecione">
                      {tiposOs.map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                    </Select>
                  </FormField>
                  <FormField label="Responsável">
                    <Select value={c.tecnicoId} onChange={(e) => onChange(l.id, { tecnicoId: e.target.value })} placeholder="Selecione">
                      {tecnicos.map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                    </Select>
                  </FormField>
                </FormGrid>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Prévia das próximas 6 OS</p>
                    <Button type="button" variant="secondary" onClick={() => setTick((t) => t + 1)} className="text-xs h-7 px-2.5"><RefreshCw className="w-3 h-3" /> Atualizar prévia</Button>
                  </div>
                  {!c.dataPrimeiraOs ? (
                    <p className="text-sm text-ink-muted">Informe a data da primeira OS para visualizar a prévia.</p>
                  ) : preview.length === 0 ? (
                    <p className="text-sm text-ink-muted">Nenhuma ocorrência com a configuração atual.</p>
                  ) : (
                    <div className="overflow-x-auto border border-surface-border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-alt border-b border-surface-border">
                          <tr>
                            <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">#</th>
                            <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Data prevista</th>
                            <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Tipo de OS</th>
                            <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Responsável</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((oc, i) => (
                            <tr key={oc.periodo} className="border-b border-surface-border last:border-0">
                              <td className="px-3 py-2 text-ink-muted">{i + 1}</td>
                              <td className="px-3 py-2 text-ink">{formatarData(oc.data)}</td>
                              <td className="px-3 py-2 text-ink">{tipoNome}</td>
                              <td className="px-3 py-2 text-ink-muted">{respNome}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-xs text-ink-subtle">Ao salvar, estas OS são criadas com status <strong>Agendada</strong>, vinculadas a este local, e aparecem no calendário e na listagem de OS.</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
