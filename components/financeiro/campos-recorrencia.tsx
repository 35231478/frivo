"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { LABELS_AJUSTE_FIM_SEMANA, LABELS_MES } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import {
  AJUDA_TERMINO, FREQUENCIAS, PASSO_MAX, ROTULO_TERMINO, TERMINOS, anosDoSeletor,
  type FormRecorrencia, type TerminoId,
} from "@/lib/financeiro/conta-pagar-recorrencia";

/**
 * Os campos da REGRA da despesa recorrente, um só bloco usado em todo lugar que mexe nela: o
 * "Repetir (recorrente)" da nova conta a pagar, o "Tornar recorrente" de uma conta avulsa e a
 * edição da regra na tela de Despesas recorrentes.
 *
 * O valor NÃO está aqui: ele é o valor da conta (de CADA ocorrência) e cada tela já tem o campo.
 * O que está aqui é só o "quando e até quando".
 */
export function CamposRecorrencia({ valor: f, onChange, anoBase }: {
  valor: FormRecorrencia;
  onChange: (f: FormRecorrencia) => void;
  /** ano que abre os seletores de competência (o corrente) */
  anoBase: number;
}) {
  const upd = <K extends keyof FormRecorrencia>(k: K, v: FormRecorrencia[K]) => onChange({ ...f, [k]: v });
  const anos = anosDoSeletor(anoBase);

  return (
    <div className="space-y-4" data-campos-recorrencia>
      <FormGrid cols={3}>
        <FormField label="Repetir" required>
          <Select value={f.frequencia} onChange={(e) => upd("frequencia", e.target.value as FormRecorrencia["frequencia"])} data-frequencia aria-label="Frequência">
            {FREQUENCIAS.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
            <option value="CUSTOM">A cada N meses…</option>
          </Select>
        </FormField>
        {f.frequencia === "CUSTOM" ? (
          <FormField label="A cada quantos meses" required hint={`De 1 a ${PASSO_MAX}`}>
            <Input type="number" min={1} max={PASSO_MAX} className={PLANILHA.numero} value={f.passoMeses}
              onChange={(e) => upd("passoMeses", e.target.value)} data-passo-meses />
          </FormField>
        ) : <div className="hidden sm:block" aria-hidden />}
        <FormField label="Dia do vencimento" required hint="De 1 a 31">
          <Input type="number" min={1} max={31} className={PLANILHA.numero} value={f.diaVencimento}
            onChange={(e) => upd("diaVencimento", e.target.value)} data-dia-vencimento />
        </FormField>
      </FormGrid>

      <FormGrid>
        <FormField label="Quando cair em fim de semana">
          <Select value={f.ajusteDiaNaoUtil} onChange={(e) => upd("ajusteDiaNaoUtil", e.target.value)} data-ajuste-dia aria-label="Quando cair em fim de semana">
            {Object.entries(LABELS_AJUSTE_FIM_SEMANA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
        <FormField label="Começa em" required>
          <div className="flex gap-2">
            <Select value={f.inicioMes} onChange={(e) => upd("inicioMes", e.target.value)} className="flex-1" data-inicio-mes aria-label="Mês de início">
              {Object.entries(LABELS_MES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select value={f.inicioAno} onChange={(e) => upd("inicioAno", e.target.value)} className="w-28 shrink-0" data-inicio-ano aria-label="Ano de início">
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>
        </FormField>
      </FormGrid>

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink flex items-center gap-1.5">
          Termina <Dica texto={AJUDA_TERMINO} rotulo="Término da despesa recorrente" />
        </p>
        <div className="space-y-2">
          {TERMINOS.map((t) => (
            <label key={t} className="flex items-start gap-2 text-sm text-ink cursor-pointer" data-termino={t}>
              <input type="radio" name="termino-recorrencia" className="mt-0.5" checked={f.termino === t}
                onChange={() => upd("termino", t as TerminoId)} />
              <span className="min-w-0">{ROTULO_TERMINO[t]}</span>
            </label>
          ))}
        </div>
        {f.termino === "DATA" && (
          <FormGrid>
            <FormField label="Último mês">
              <div className="flex gap-2">
                <Select value={f.fimMes} onChange={(e) => upd("fimMes", e.target.value)} className="flex-1" data-fim-mes aria-label="Mês do término">
                  <option value="">Selecione…</option>
                  {Object.entries(LABELS_MES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <Select value={f.fimAno} onChange={(e) => upd("fimAno", e.target.value)} className="w-28 shrink-0" data-fim-ano aria-label="Ano do término">
                  <option value="">Ano</option>
                  {anos.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
              </div>
            </FormField>
          </FormGrid>
        )}
        {f.termino === "OCORRENCIAS" && (
          <FormGrid>
            <FormField label="Quantas ocorrências" hint="Contando da primeira">
              <Input type="number" min={1} className={PLANILHA.numero} value={f.ocorrencias}
                onChange={(e) => upd("ocorrencias", e.target.value)} data-ocorrencias />
            </FormField>
          </FormGrid>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm text-ink cursor-pointer" data-valor-estimado>
        <input type="checkbox" className="mt-0.5" checked={f.valorEstimado} onChange={(e) => upd("valorEstimado", e.target.checked)} />
        <span className="min-w-0">
          Valor a confirmar (estimado)
          <span className="block text-xs text-ink-muted">Para energia, água e cartão: a conta nasce com o valor previsto e você ajusta quando o boleto chega.</span>
        </span>
      </label>
    </div>
  );
}
