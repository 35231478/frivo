"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import {
  FREQUENCIAS_RECORRENCIA, LABELS_PERIODICIDADE, LABELS_PERFIL_FATURAMENTO,
  VARIAVEIS_TERMO, calcularDataFimContrato, formatarData,
} from "@/lib/utils";
import { FileText, Wrench, Clock } from "lucide-react";

export interface PropostaState {
  valorMensal: string;
  frequenciaContrato: string;
  diaExecucao: string;
  dataInicioContrato: string;
  vigenciaMeses: string;
  condicaoPagamento: string;
  diaFaturamento: string;
  perfilFaturamento: string;
  exigePcAntesNf: boolean;
  responsavelTecnicoId: string;
  artNumero: string;
  termoReferencia: string;
  visitasPorPeriodo: string;
  equipamentosCobertos: string[];
  prazoEmergencial: string;
  prazoNormal: string;
  horarioAtendimento: string;
}

export const PROPOSTA_VAZIA: PropostaState = {
  valorMensal: "", frequenciaContrato: "MENSAL", diaExecucao: "", dataInicioContrato: "",
  vigenciaMeses: "12", condicaoPagamento: "", diaFaturamento: "", perfilFaturamento: "",
  exigePcAntesNf: false, responsavelTecnicoId: "", artNumero: "", termoReferencia: "",
  visitasPorPeriodo: "", equipamentosCobertos: [], prazoEmergencial: "", prazoNormal: "",
  horarioAtendimento: "",
};

interface PropostaCamposProps {
  proposta: PropostaState;
  onChange: (patch: Partial<PropostaState>) => void;
  tecnicos: { id: string; nome: string; crea?: string | null }[];
  termoTemplates: { id: string; nome: string; conteudo: string }[];
  equipamentos: { id: string; rotulo: string }[];
}

const VIGENCIAS = [6, 12, 24, 36];

export function PropostaCampos({ proposta, onChange, tecnicos, termoTemplates, equipamentos }: PropostaCamposProps) {
  const dataFim = calcularDataFimContrato(
    proposta.dataInicioContrato || null,
    proposta.vigenciaMeses ? Number(proposta.vigenciaMeses) : null,
  );

  function aplicarTemplate(id: string) {
    const t = termoTemplates.find((x) => x.id === id);
    if (t) onChange({ termoReferencia: t.conteudo });
  }

  function inserirVariavel(v: string) {
    onChange({ termoReferencia: `${proposta.termoReferencia}${proposta.termoReferencia && !proposta.termoReferencia.endsWith(" ") ? " " : ""}${v}` });
  }

  function toggleEquip(id: string) {
    const set = new Set(proposta.equipamentosCobertos);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange({ equipamentosCobertos: [...set] });
  }

  return (
    <div className="space-y-6">
      {/* Dados do contrato proposto */}
      <div className="card-padded">
        <FormSection title="Dados do contrato proposto">
          <FormGrid cols={3}>
            <FormField label="Valor mensal (R$)" required>
              <Input type="number" step="0.01" min="0" value={proposta.valorMensal}
                onChange={(e) => onChange({ valorMensal: e.target.value })} placeholder="0,00" />
            </FormField>
            <FormField label="Frequência das visitas">
              <Select value={proposta.frequenciaContrato} onChange={(e) => onChange({ frequenciaContrato: e.target.value })}>
                {FREQUENCIAS_RECORRENCIA.map((f) => (
                  <option key={f} value={f}>{LABELS_PERIODICIDADE[f]}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Dia de execução" hint="Dia do mês para a visita">
              <Input type="number" min="1" max="31" value={proposta.diaExecucao}
                onChange={(e) => onChange({ diaExecucao: e.target.value })} placeholder="Ex.: 5" />
            </FormField>
            <FormField label="Data de início">
              <Input type="date" value={proposta.dataInicioContrato}
                onChange={(e) => onChange({ dataInicioContrato: e.target.value })} />
            </FormField>
            <FormField label="Vigência (meses)">
              <Select value={proposta.vigenciaMeses} onChange={(e) => onChange({ vigenciaMeses: e.target.value })}>
                {VIGENCIAS.map((m) => <option key={m} value={m}>{m} meses</option>)}
              </Select>
            </FormField>
            <FormField label="Data fim (calculada)">
              <Input value={dataFim ? formatarData(dataFim) : "—"} disabled readOnly />
            </FormField>
            <FormField label="Condição de pagamento" hint="Ex.: 30 dias após medição">
              <Input value={proposta.condicaoPagamento}
                onChange={(e) => onChange({ condicaoPagamento: e.target.value })} placeholder="Ex.: todo dia 05" />
            </FormField>
            <FormField label="Dia de faturamento" hint="1 a 28">
              <Input type="number" min="1" max="28" value={proposta.diaFaturamento}
                onChange={(e) => onChange({ diaFaturamento: e.target.value })} placeholder="Ex.: 1" />
            </FormField>
            <FormField label="Perfil de faturamento">
              <Select value={proposta.perfilFaturamento} onChange={(e) => onChange({ perfilFaturamento: e.target.value })} placeholder="Selecione...">
                {Object.entries(LABELS_PERFIL_FATURAMENTO).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Responsável técnico">
              <Select value={proposta.responsavelTecnicoId} onChange={(e) => onChange({ responsavelTecnicoId: e.target.value })} placeholder="Selecione...">
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}{t.crea ? ` — CREA ${t.crea}` : ""}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Número da ART">
              <Input value={proposta.artNumero} onChange={(e) => onChange({ artNumero: e.target.value })} placeholder="Ex.: 1234567" />
            </FormField>
          </FormGrid>
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer mt-2">
            <input type="checkbox" checked={proposta.exigePcAntesNf}
              onChange={(e) => onChange({ exigePcAntesNf: e.target.checked })}
              className="w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" />
            Exige Pedido de Compra (PC) antes da emissão da NF
          </label>
        </FormSection>
      </div>

      {/* Termo de referência */}
      <div className="card-padded">
        <FormSection title="Termo de referência">
          <FormField label="Carregar de um template">
            <Select value="" onChange={(e) => { if (e.target.value) aplicarTemplate(e.target.value); }} placeholder="Selecione um template...">
              {termoTemplates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          </FormField>
          <div className="flex flex-wrap gap-1.5">
            {VARIAVEIS_TERMO.map((v) => (
              <button key={v} type="button" onClick={() => inserirVariavel(v)}
                className="inline-flex items-center gap-1 text-[11px] font-mono bg-primary-50 text-primary-700 border border-primary-100 rounded px-2 py-1 hover:bg-primary-100 transition-colors">
                <FileText className="w-3 h-3" /> {v}
              </button>
            ))}
          </div>
          <FormField label="Conteúdo do termo">
            <Textarea value={proposta.termoReferencia} onChange={(e) => onChange({ termoReferencia: e.target.value })} rows={10}
              placeholder="Ex.: A CONTRATADA prestará serviços de manutenção preventiva para {{cliente_nome}}, no valor mensal de {{valor_mensal}}..." />
          </FormField>
        </FormSection>
      </div>

      {/* Escopo */}
      <div className="card-padded">
        <FormSection title="Escopo dos serviços">
          <div className="flex items-center gap-2 text-xs text-ink-muted mb-1">
            <Wrench className="w-3.5 h-3.5" /> Os serviços inclusos são os listados na tabela de <strong>Serviços</strong> acima.
          </div>
          <FormGrid cols={2}>
            <FormField label="Visitas por período" hint="Quantidade de visitas em cada ciclo">
              <Input type="number" min="1" value={proposta.visitasPorPeriodo}
                onChange={(e) => onChange({ visitasPorPeriodo: e.target.value })} placeholder="Ex.: 1" />
            </FormField>
          </FormGrid>
          <FormField label="Equipamentos cobertos">
            {equipamentos.length === 0 ? (
              <p className="text-sm text-ink-subtle">Nenhum equipamento cadastrado para este cliente.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto border border-surface-border rounded-lg p-2">
                {equipamentos.map((eq) => (
                  <label key={eq.id} className="flex items-center gap-2 text-sm text-ink cursor-pointer hover:bg-surface-alt rounded px-2 py-1">
                    <input type="checkbox" checked={proposta.equipamentosCobertos.includes(eq.id)}
                      onChange={() => toggleEquip(eq.id)}
                      className="w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                    {eq.rotulo}
                  </label>
                ))}
              </div>
            )}
          </FormField>
        </FormSection>
      </div>

      {/* SLA */}
      <div className="card-padded">
        <FormSection title="SLA de atendimento">
          <FormGrid cols={3}>
            <FormField label="Atendimento emergencial (horas)">
              <Input type="number" min="0" value={proposta.prazoEmergencial}
                onChange={(e) => onChange({ prazoEmergencial: e.target.value })} placeholder="Ex.: 4" />
            </FormField>
            <FormField label="Atendimento normal (horas)">
              <Input type="number" min="0" value={proposta.prazoNormal}
                onChange={(e) => onChange({ prazoNormal: e.target.value })} placeholder="Ex.: 48" />
            </FormField>
            <FormField label="Horário de atendimento">
              <Input value={proposta.horarioAtendimento}
                onChange={(e) => onChange({ horarioAtendimento: e.target.value })} placeholder="Ex.: Seg-Sex 8h-18h" />
            </FormField>
          </FormGrid>
          <p className="flex items-center gap-1.5 text-xs text-ink-muted"><Clock className="w-3.5 h-3.5" /> Prazos exibidos no documento da proposta.</p>
        </FormSection>
      </div>
    </div>
  );
}
