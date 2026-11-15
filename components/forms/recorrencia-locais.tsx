"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { COLABORADOR, TECNICO, TIPO_OS } from "@/components/cadastro-rapido/definicoes";
import { toast } from "@/components/ui/avisos";
import { PLANILHA } from "@/lib/planilha";
import { cn } from "@/lib/utils";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { proximasOcorrencias } from "@/lib/recorrencia-helpers";
import { FREQUENCIAS_RECORRENCIA, LABELS_PERIODICIDADE, formatarData } from "@/lib/utils";
import { MapPin, RefreshCw } from "lucide-react";
import { InputData } from "@/components/ui/input-data";
import { diaCivilDeChave, diaDoMesCivil } from "@/lib/fuso";

export interface LocalConfig {
  ativa: boolean;
  frequencia: string;
  tipoOsId: string;
  tecnicoId: string;
  dataPrimeiraOs: string;
}

interface Props {
  locais: { id: string; nome: string }[];
  tiposOs: { id: string; nome: string; descricao?: string | null; cor?: string | null }[];
  tecnicos: { id: string; nome: string }[];
  value: Record<string, LocalConfig>;
  onChange: (unidadeId: string, patch: Partial<LocalConfig>) => void;
  /** Cadastro rápido e edição no contexto: a lista do formulário é do pai, então ele é avisado. */
  aoMudarTiposOs?: (tipos: { id: string; nome: string }[]) => void;
  aoMudarTecnicos?: (tecnicos: { id: string; nome: string }[]) => void;
}

const cfgPadrao = (): LocalConfig => ({ ativa: false, frequencia: "MENSAL", tipoOsId: "", tecnicoId: "", dataPrimeiraOs: "" });

export function RecorrenciaLocais({ locais, tiposOs, tecnicos, value, onChange, aoMudarTiposOs, aoMudarTecnicos }: Props) {
  const [tick, setTick] = useState(0);

  if (locais.length === 0) {
    return <p className="text-sm text-ink-muted">Cadastre os locais cobertos primeiro na aba <strong>Locais cobertos</strong>.</p>;
  }

  return (
    <div className="space-y-3" data-tick={tick}>
      {locais.map((l) => {
        const c = value[l.id] ?? cfgPadrao();
        const base = diaCivilDeChave(c.dataPrimeiraOs); // o dia escolhido, sem fuso
        const preview = (c.ativa && c.frequencia && base)
          ? proximasOcorrencias({ dataInicio: base, frequencia: c.frequencia, diaRecorrencia: diaDoMesCivil(base), limite: 6, aPartirDe: base })
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
              <div className="space-y-4 border-l-2 border-surface-border pl-4">
                <FormGrid cols={2}>
                  <FormField label="Frequência">
                    <Select value={c.frequencia} onChange={(e) => onChange(l.id, { frequencia: e.target.value })}>
                      {FREQUENCIAS_RECORRENCIA.map((f) => (<option key={f} value={f}>{LABELS_PERIODICIDADE[f]}</option>))}
                    </Select>
                  </FormField>
                  <FormField label="Data da primeira OS">
                    <InputData value={c.dataPrimeiraOs} onChange={(v) => onChange(l.id, { dataPrimeiraOs: v })} />
                  </FormField>
                </FormGrid>
                <FormGrid cols={2}>
                  <FormField label="Tipo de OS" dica="Cadastrar ou editar aqui mexe no cadastro do tipo de OS, valendo em todo o sistema.">
                    <SelectCadastroRapido
                      value={c.tipoOsId}
                      onChange={(v) => onChange(l.id, { tipoOsId: v })}
                      opcoes={tiposOs.map((t) => ({ value: t.id, label: t.nome }))}
                      entidade={TIPO_OS.entidade} placeholder="Selecione" campos={TIPO_OS.campos} campoBusca="nome"
                      permissao={TIPO_OS.permissao} linkCadastroCompleto={TIPO_OS.link}
                      criar={async (v) => {
                        const t = await TIPO_OS.criar(v);
                        aoMudarTiposOs?.([...tiposOs, t].sort((a, b) => a.nome.localeCompare(b.nome)));
                        onChange(l.id, { tipoOsId: t.id });
                        toast("Tipo de OS cadastrado.");
                        return { value: t.id, label: t.nome };
                      }}
                      edicao={c.tipoOsId ? TIPO_OS.edicao(tiposOs, (t) => aoMudarTiposOs?.(tiposOs.map((x) => (x.id === t.id ? { ...x, ...t } : x)))) : undefined}
                    />
                  </FormField>
                  <FormField label="Responsável" dica="Cadastrar ou editar aqui mexe no cadastro do colaborador, valendo em todo o sistema.">
                    <SelectCadastroRapido
                      value={c.tecnicoId}
                      onChange={(v) => onChange(l.id, { tecnicoId: v })}
                      opcoes={tecnicos.map((t) => ({ value: t.id, label: t.nome }))}
                      entidade={TECNICO.entidade} placeholder="Selecione" campos={TECNICO.campos} campoBusca="nome"
                      permissao={TECNICO.permissao} linkCadastroCompleto={TECNICO.link}
                      criar={async (v) => {
                        // Com o tipo de OS já escolhido, o técnico nasce habilitado nessa competência
                        const t = await TECNICO.criar(v, c.tipoOsId || undefined);
                        aoMudarTecnicos?.([...tecnicos, { id: t.id, nome: t.nome }].sort((a, b) => a.nome.localeCompare(b.nome)));
                        onChange(l.id, { tecnicoId: t.id });
                        toast("Colaborador cadastrado.");
                        return { value: t.id, label: t.nome };
                      }}
                      edicao={c.tecnicoId ? COLABORADOR.edicao((t) => aoMudarTecnicos?.(tecnicos.map((x) => (x.id === t.id ? { ...x, nome: t.nome } : x)))) : undefined}
                    />
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
                    <div className="overflow-x-auto border border-surface-border rounded-lg" data-previa-recorrencia>
                      <table className={PLANILHA.tabela}>
                        <thead>
                          <tr className={PLANILHA.cabecalho}>
                            <th scope="col" className={cn(PLANILHA.th, "text-right w-10")}>#</th>
                            <th scope="col" className={cn(PLANILHA.th, "text-left")}>Data prevista</th>
                            <th scope="col" className={cn(PLANILHA.th, "text-left")}>Tipo de OS</th>
                            <th scope="col" className={cn(PLANILHA.th, "text-left")}>Responsável</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((oc, i) => (
                            <tr key={oc.periodo} className={PLANILHA.linha}>
                              <td className={cn(PLANILHA.td, PLANILHA.numero, "text-ink-muted")}>{i + 1}</td>
                              <td className={cn(PLANILHA.td, PLANILHA.data)}>{formatarData(oc.data)}</td>
                              <td className={PLANILHA.td}>{tipoNome}</td>
                              <td className={cn(PLANILHA.td, "text-ink-muted")}>{respNome}</td>
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
