"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import {
  ADICIONAIS, ADICIONAL_LABEL, AVISO_GESTAO, REGIMES, REGIME_LABEL, calcularCusto, horasDoMes,
  type Adicional, type ItemEncargo, type Regime,
} from "@/lib/folha/calculo";
import { lerValor } from "@/lib/folha/validacao";
import { formatarMoeda } from "@/lib/utils";

/**
 * Seção "Dados financeiros / Folha" do colaborador (aba do cadastro). Só é montada para quem tem
 * "Financeiro › Custo de pessoal"; o servidor confere de novo em GET/PUT /api/folha/colaboradores/[id].
 * Não é um <form> (fica dentro do formulário do colaborador): salva por conta própria.
 */

interface Modelo { id: string; nome: string; regime: Regime; padrao: boolean; itens: ItemEncargo[] }

const CAMPOS_VALOR = ["salario", "valorDiaria", "diasMes", "horasMes", "adicionalPercent", "adicionalValor", "horasExtrasValor",
  "valeTransporte", "valeAlimentacao", "planoSaude", "outrosBeneficios", "descontos"] as const;
type CampoValor = (typeof CAMPOS_VALOR)[number];

type Estado = Record<CampoValor, string> & {
  regime: Regime; adicionalTipo: Adicional; descontaVt: boolean; modeloEncargosId: string;
  descontosDescricao: string; observacoes: string;
};

const paraTexto = (v: unknown) => (v == null ? "" : String(v).replace(".", ","));
const valorNum = (s: string) => { const v = lerValor(s); return v == null || Number.isNaN(v) ? null : v; };

export function FolhaColaborador({ colaboradorId }: { colaboradorId: string }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [e, setE] = useState<Estado | null>(null);

  function aplicar(d: any) {
    const f = d.folha;
    setModelos(d.modelos);
    setE({
      ...Object.fromEntries(CAMPOS_VALOR.map((c) => [c, paraTexto(f[c])])) as Record<CampoValor, string>,
      regime: f.regime, adicionalTipo: f.adicionalTipo, descontaVt: f.descontaVt,
      modeloEncargosId: f.modeloEncargosId ?? "", descontosDescricao: f.descontosDescricao ?? "", observacoes: f.observacoes ?? "",
    });
  }

  useEffect(() => {
    fetch(`/api/folha/colaboradores/${colaboradorId}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.erro); aplicar(d); })
      .catch((x) => setErro(x?.message || "Não foi possível carregar os dados financeiros."))
      .finally(() => setCarregando(false));
  }, [colaboradorId]);

  const set = <K extends keyof Estado>(k: K, v: Estado[K]) => { setOk(false); setE((p) => (p ? { ...p, [k]: v } : p)); };

  const modelosDoRegime = useMemo(() => modelos.filter((m) => e && m.regime === e.regime), [modelos, e]);
  const padrao = modelosDoRegime.find((m) => m.padrao) ?? modelosDoRegime[0];
  const modelo = modelosDoRegime.find((m) => m.id === e?.modeloEncargosId) ?? padrao;

  const custo = useMemo(() => {
    if (!e) return null;
    const v = Object.fromEntries(CAMPOS_VALOR.map((c) => [c, valorNum(e[c])]));
    return calcularCusto({ ...v, regime: e.regime, adicionalTipo: e.adicionalTipo, descontaVt: e.descontaVt }, modelo?.itens ?? []);
  }, [e, modelo]);

  async function salvar() {
    if (!e) return;
    setErro(""); setOk(false);
    for (const c of CAMPOS_VALOR) {
      if (e[c].trim() && Number.isNaN(lerValor(e[c]))) { setErro("Confira os valores: use números como 3200,00."); return; }
    }
    setSalvando(true);
    try {
      const corpo = {
        ...Object.fromEntries(CAMPOS_VALOR.map((c) => [c, e[c].trim() || null])),
        regime: e.regime, adicionalTipo: e.adicionalTipo, descontaVt: e.descontaVt,
        modeloEncargosId: e.modeloEncargosId || null,
        descontosDescricao: e.descontosDescricao || null, observacoes: e.observacoes || null,
      };
      const r = await fetch(`/api/folha/colaboradores/${colaboradorId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Erro ao salvar os dados financeiros."); return; }
      aplicar(d);
      setOk(true);
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Carregando dados financeiros…</p>;
  if (!e || !custo) return <p className="text-sm text-red-600">{erro || "Não foi possível carregar os dados financeiros."}</p>;

  const diarista = e.regime === "DIARISTA";
  const campo = (k: CampoValor, rotulo: string, opts: { hint?: string; prefixo?: string; placeholder?: string } = {}) => (
    <FormField label={rotulo} hint={opts.hint}>
      <div className="relative">
        {opts.prefixo && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">{opts.prefixo}</span>}
        <Input inputMode="decimal" value={e[k]} onChange={(ev) => set(k, ev.target.value)} placeholder={opts.placeholder ?? "0,00"}
          aria-label={rotulo} data-campo={k} className={opts.prefixo ? "pl-9" : undefined} />
      </div>
    </FormField>
  );
  const linhaResumo = (rotulo: string, valor: number, sinal: "+" | "−" = "+", destaque = false) => (
    <div className={destaque ? "flex justify-between gap-3 pt-2 mt-1 border-t border-surface-border font-semibold text-ink" : "flex justify-between gap-3 text-ink-muted"}>
      <span>{rotulo}</span>
      <span className="tabular-nums whitespace-nowrap">{sinal === "−" && valor > 0 ? "− " : ""}{formatarMoeda(valor)}</span>
    </div>
  );

  return (
    <div className="space-y-6" data-secao="folha">
      <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
        <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <p>{AVISO_GESTAO}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div className="space-y-8 min-w-0">
          <FormSection title="Contrato e salário">
            <FormGrid>
              <FormField label="Tipo de contrato" required>
                <Select value={e.regime} aria-label="Tipo de contrato" onChange={(ev) => { set("regime", ev.target.value as Regime); set("modeloEncargosId", ""); }}>
                  {REGIMES.map((r) => <option key={r} value={r}>{REGIME_LABEL[r]}</option>)}
                </Select>
              </FormField>
              <FormField label="Modelo de encargos" hint="Percentuais em Financeiro → Custo de pessoal → Encargos">
                <Select value={e.modeloEncargosId} aria-label="Modelo de encargos" onChange={(ev) => set("modeloEncargosId", ev.target.value)}>
                  <option value="">Padrão do tipo{padrao ? `: ${padrao.nome}` : ""}</option>
                  {modelosDoRegime.filter((m) => m.id !== padrao?.id).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </Select>
              </FormField>
            </FormGrid>
            {diarista ? (
              <FormGrid cols={3}>
                {campo("valorDiaria", "Valor da diária", { prefixo: "R$" })}
                {campo("diasMes", "Dias no mês", { placeholder: "22" })}
                {campo("horasMes", "Horas no mês", { placeholder: String(horasDoMes({ regime: "DIARISTA", diasMes: valorNum(e.diasMes) })), hint: "Para o custo-hora" })}
              </FormGrid>
            ) : (
              <FormGrid>
                {campo("salario", e.regime === "CLT" ? "Salário-base mensal" : "Valor mensal (base)", { prefixo: "R$" })}
                {campo("horasMes", "Horas pagas no mês", { placeholder: "220", hint: "Para o custo-hora (CLT 44h/semana = 220h)" })}
              </FormGrid>
            )}
          </FormSection>

          <FormSection title="Adicionais">
            <FormGrid cols={3}>
              <FormField label="Adicional">
                <Select value={e.adicionalTipo} aria-label="Adicional" onChange={(ev) => set("adicionalTipo", ev.target.value as Adicional)}>
                  {ADICIONAIS.map((a) => <option key={a} value={a}>{ADICIONAL_LABEL[a]}</option>)}
                </Select>
              </FormField>
              {e.adicionalTipo !== "NENHUM" && campo("adicionalPercent", "% sobre a base", { placeholder: e.adicionalTipo === "PERICULOSIDADE" ? "30" : "20" })}
              {e.adicionalTipo !== "NENHUM" && campo("adicionalValor", "ou valor fixo", { prefixo: "R$", hint: "Tem prioridade sobre o %" })}
            </FormGrid>
            {e.adicionalTipo === "INSALUBRIDADE" && (
              <p className="text-xs text-ink-muted -mt-2">Insalubridade costuma ser calculada sobre o salário mínimo: nesse caso, informe o valor fixo em R$.</p>
            )}
            <FormGrid>{campo("horasExtrasValor", "Horas extras (estimativa mensal)", { prefixo: "R$", hint: "Manual por enquanto (sem integração com ponto)" })}</FormGrid>
          </FormSection>

          <FormSection title="Benefícios (custo mensal da empresa)">
            <FormGrid>
              {campo("valeTransporte", "Vale-transporte", { prefixo: "R$" })}
              {campo("valeAlimentacao", "VA / VR", { prefixo: "R$" })}
              {campo("planoSaude", "Plano de saúde", { prefixo: "R$" })}
              {campo("outrosBeneficios", "Outros benefícios", { prefixo: "R$" })}
            </FormGrid>
            {e.regime === "CLT" && (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={e.descontaVt} onChange={(ev) => set("descontaVt", ev.target.checked)}
                  className="w-4 h-4 rounded border-surface-border text-primary-600" />
                Descontar do empregado até 6% do salário-base no VT
              </label>
            )}
          </FormSection>

          <FormSection title="Descontos">
            <FormGrid>
              {campo("descontos", "Outros descontos", { prefixo: "R$", hint: "Reduzem o custo (ex.: coparticipação do plano)" })}
              <FormField label="Descrição dos descontos">
                <Input value={e.descontosDescricao} onChange={(ev) => set("descontosDescricao", ev.target.value)} maxLength={200} />
              </FormField>
            </FormGrid>
            <FormField label="Observações (financeiro)">
              <Textarea value={e.observacoes} onChange={(ev) => set("observacoes", ev.target.value)} rows={2} maxLength={1000} />
            </FormField>
          </FormSection>
        </div>

        <aside className="lg:sticky lg:top-4 rounded-xl border border-surface-border bg-surface-alt/60 p-4 text-sm space-y-1.5" data-resumo-custo>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-2">Custo mensal estimado</p>
          {linhaResumo(diarista ? "Base (diárias)" : "Salário/base", custo.base)}
          {custo.adicional > 0 && linhaResumo(ADICIONAL_LABEL[e.adicionalTipo], custo.adicional)}
          {custo.horasExtras > 0 && linhaResumo("Horas extras", custo.horasExtras)}
          {linhaResumo(`Encargos (${custo.percentualEncargos.toLocaleString("pt-BR")}%)`, custo.encargos)}
          {linhaResumo("Benefícios", custo.beneficios)}
          {custo.descontos > 0 && linhaResumo(custo.descontoVt > 0 ? "Descontos (inclui 6% VT)" : "Descontos", custo.descontos, "−")}
          {linhaResumo("Custo total / mês", custo.total, "+", true)}
          <div className="flex justify-between gap-3 text-ink-muted pt-1">
            <span>Custo-hora ({custo.horasMes}h)</span>
            <span className="tabular-nums font-medium text-ink">{formatarMoeda(custo.custoHora)}</span>
          </div>
          {modelo && custo.encargosItens.length > 0 && (
            <details className="pt-2 text-xs text-ink-muted">
              <summary className="cursor-pointer">Encargos: {modelo.nome}</summary>
              <ul className="mt-1 space-y-0.5">
                {custo.encargosItens.map((i) => <li key={i.nome} className="flex justify-between gap-2"><span>{i.nome} ({i.percentual.toLocaleString("pt-BR")}%)</span><span className="tabular-nums">{formatarMoeda(i.valor)}</span></li>)}
              </ul>
            </details>
          )}
        </aside>
      </div>

      {erro && <p className="flex items-center gap-2 text-sm text-red-600"><AlertCircle className="w-4 h-4" /> {erro}</p>}
      <div className="flex items-center justify-end gap-3">
        {ok && <span className="flex items-center gap-1 text-sm text-success-600"><Check className="w-4 h-4" /> Dados financeiros salvos</span>}
        <Button type="button" onClick={salvar} loading={salvando} data-acao="salvar-folha">Salvar dados financeiros</Button>
      </div>
    </div>
  );
}
