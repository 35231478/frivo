"use client";

import { useState } from "react";
import { Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import {
  BASES, DIVISOES, MAX_DIA_FIXO, MAX_DIA_UTIL, ORDEM_PRECEDENCIA, PAPEIS, PAPEIS_ATIVOS, QUANDO, QUANDO_EXECUTOR, QUEM, RETORNO_DIAS_MAX, ROTULO_BASE, ROTULO_DIVISAO,
  ROTULO_PAPEL, ROTULO_QUANDO, ROTULO_QUANDO_EXECUTOR, ROTULO_QUEM, ROTULO_SOBRE, ROTULO_VENCIMENTO_TIPO, SOBRE, VENCIMENTO_TIPOS, descricaoDaRegra, descricaoDoVencimento,
  type Base, type Divisao, type Papel, type Quando, type QuandoExecutor, type Quem, type RegraComissao, type Sobre, type VencimentoFechamento, type VencimentoTipo,
} from "@/lib/comissoes/regras";

export interface RegraNaTela extends RegraComissao { ativo: boolean; nomes: { pessoa: string | null; cargo: string | null; servico: string | null } }
export interface TetoNaTela { id: string; quemTipo: "PESSOA" | "CARGO"; usuarioId: string | null; cargoId: string | null; valor: number; ativo: boolean; nome: string }
export interface ConfigComissoes {
  quando: Quando; liquidaImpostos: boolean;
  /** COM-1.1: o vencimento da conta a pagar do fechamento */
  vencimento: VencimentoFechamento;
  /** COM-2: o técnico — quando fica devida, os dias do retorno e os tipos de OS que contam como retorno */
  executorQuando: QuandoExecutor; retornoDias: number; tiposRetorno: string[];
}
export interface TelaComissoesDados {
  regras: RegraNaTela[];
  config: ConfigComissoes;
  opcoes: { pessoas: { id: string; nome: string }[]; cargos: { id: string; nome: string }[]; servicos: { id: string; nome: string }[]; categorias: string[]; tiposOs: { id: string; nome: string }[] };
  tetos: TetoNaTela[];
}

const DICA_PRECEDENCIA = "O item manda, a pessoa desempata: a regra de um serviço vence a da categoria, que vence a de todos os serviços. No mesmo item, pessoa vence cargo, que vence todos. Peças só valem para as linhas de peça.";
const EXEMPLO_PRECEDENCIA = "Ana tem 7% fixo (pessoa + todos os serviços). No item Instalação VRF vale a regra do serviço (3%).";
const DICA_QUANDO = "Por data de recebimento: cada parcela paga libera a parte proporcional da comissão. Na aprovação do orçamento ou na conclusão da OS: libera tudo de uma vez (e estorna se a fatura for cancelada). No fechamento do mês dá para ver por data de emissão da fatura ou de recebimento. A comissão nasce na aprovação e guarda a regra daquele dia: mudar aqui não mexe no passado.";
const DICA_VENCIMENTO = "A data de vencimento da conta a pagar que o fechamento do mês gera para cada pessoa (bônus e comissão juntos). Dia útil = segunda a sexta; feriados não entram. Se a data já passou quando o mês é fechado, vence no dia.";

const DICA_EXECUTOR = "A comissão do técnico nasce por equipamento atendido com o relatório completo (checklist, fotos, medições e formulário que a OS pede) e fica Prevista. Ela é liberada no gatilho escolhido. Na % da venda, cada equipamento ganha a parte da linha (valor ÷ equipamentos da OS).";
const DICA_RETORNO = "Outra OS de um tipo de retorno, no mesmo equipamento, dentro destes dias depois do serviço: a comissão do técnico fica em revisão (não libera) até o encarregado decidir, em Desempenho › Fechamento. Quem registrou o problema no serviço não entra. 0 desliga.";
const DICA_DIVISAO = "Igual: cada técnico da atividade recebe a mesma parte. Para quem executou: vai para quem marcou o equipamento como feito. % por cargo: pelo cargo de quem estava lá (60/40 entre Técnico e Ajudante, por exemplo).";
const DICA_TETO = "O máximo de comissão por mês. O teto da pessoa vence o do cargo. O que passar fica para o mês seguinte (não se perde).";

type Form = {
  id?: string; quemTipo: Quem; usuarioId: string; cargoId: string; papel: Papel; sobreTipo: Sobre; categoria: string; servicoId: string; base: Base; valor: string;
  divisao: Divisao; divisaoCargos: Record<string, string>;
};
const VAZIO: Form = { quemTipo: "TODOS", usuarioId: "", cargoId: "", papel: "VENDEDOR", sobreTipo: "TODOS_SERVICOS", categoria: "", servicoId: "", base: "PERC_VENDA", valor: "", divisao: "IGUAL", divisaoCargos: {} };
type FormTeto = { quemTipo: "PESSOA" | "CARGO"; usuarioId: string; cargoId: string; valor: string };
const numero = (v: string) => Number(String(v).replace(",", "."));

const valorDaRegra = (r: Pick<RegraComissao, "base" | "valor">) => r.base === "FIXO_ITEM"
  ? r.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  : `${r.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/**
 * COM-1 — Configurações › Comissões: QUANDO fica devida, a base e as REGRAS em linhas (quem · papel · sobre · base ·
 * valor). Regra não se apaga: desativa (a comissão que já nasceu guarda a regra como era). O servidor confere tudo.
 */
export function ComissoesClient({ inicial }: { inicial: TelaComissoesDados }) {
  const [dados, setDados] = useState(inicial);
  const [config, setConfig] = useState(inicial.config);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [teto, setTeto] = useState<FormTeto | null>(null);
  const [erroTeto, setErroTeto] = useState<string | null>(null);
  const [diaTexto, setDiaTexto] = useState(String(inicial.config.vencimento.dia));
  const maxDia = config.vencimento.tipo === "DIA_UTIL" ? MAX_DIA_UTIL : MAX_DIA_FIXO;
  const diaNum = Number(diaTexto);
  const diaOk = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= maxDia;
  const mudou = config.quando !== dados.config.quando || config.liquidaImpostos !== dados.config.liquidaImpostos
    || config.vencimento.tipo !== dados.config.vencimento.tipo || (diaOk && diaNum !== dados.config.vencimento.dia)
    // COM-2: o técnico
    || config.executorQuando !== dados.config.executorQuando || config.retornoDias !== dados.config.retornoDias
    || [...config.tiposRetorno].sort().join() !== [...dados.config.tiposRetorno].sort().join();
  const temExecutor = dados.regras.some((r) => r.papel === "EXECUTOR" && r.ativo);

  async function recarregar() {
    const r = await fetch("/api/comissoes");
    if (r.ok) setDados(await r.json());
  }

  async function salvarConfig() {
    setSalvandoConfig(true);
    try {
      const vencimento = { tipo: config.vencimento.tipo, dia: diaNum };
      const r = await fetch("/api/comissoes", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quando: config.quando, liquidaImpostos: config.liquidaImpostos, vencimentoTipo: vencimento.tipo, vencimentoDia: vencimento.dia,
          executorQuando: config.executorQuando, retornoDias: config.retornoDias, tiposRetorno: config.tiposRetorno,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível salvar.", "erro"); return; }
      setConfig((c) => ({ ...c, vencimento }));
      setDados((x) => ({ ...x, config: { ...config, vencimento } }));
      toast("Configuração das comissões salva.");
    } finally { setSalvandoConfig(false); }
  }

  async function gravar(f: Form, extra: { ativo?: boolean } = {}) {
    const corpo = {
      quemTipo: f.quemTipo, usuarioId: f.usuarioId || null, cargoId: f.cargoId || null, papel: f.papel, sobreTipo: f.sobreTipo,
      categoria: f.categoria || null, servicoId: f.servicoId || null, base: f.base, valor: numero(f.valor), ...extra,
      // COM-2: a divisão só vai no Executor
      ...(f.papel === "EXECUTOR" ? {
        divisao: f.divisao,
        divisaoCargos: f.divisao === "POR_CARGO" ? Object.fromEntries(Object.entries(f.divisaoCargos).filter(([, v]) => v.trim()).map(([k, v]) => [k, numero(v)])) : null,
      } : {}),
    };
    const r = await fetch(f.id ? `/api/comissoes/regras/${f.id}` : "/api/comissoes/regras", {
      method: f.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? null : (d.erro ?? "Não foi possível salvar a regra.");
  }

  async function salvarRegra() {
    if (!form) return;
    setSalvando(true); setErro(null);
    try {
      const e = await gravar(form);
      if (e) { setErro(e); return; }
      toast(form.id ? "Regra atualizada." : "Regra criada.");
      setForm(null);
      await recarregar();
    } finally { setSalvando(false); }
  }

  async function alternar(r: RegraNaTela) {
    const e = await gravar({ ...paraForm(r) }, { ativo: !r.ativo });
    if (e) { toast(e, "erro"); return; }
    toast(r.ativo ? "Regra desativada." : "Regra reativada.");
    await recarregar();
  }

  const paraForm = (r: RegraNaTela): Form => ({
    id: r.id, quemTipo: r.quemTipo, usuarioId: r.usuarioId ?? "", cargoId: r.cargoId ?? "", papel: r.papel, sobreTipo: r.sobreTipo,
    categoria: r.categoria ?? "", servicoId: r.servicoId ?? "", base: r.base, valor: String(r.valor).replace(".", ","),
    divisao: r.divisao ?? "IGUAL", divisaoCargos: Object.fromEntries(Object.entries(r.divisaoCargos ?? {}).map(([k, v]) => [k, String(v).replace(".", ",")])),
  });

  async function salvarTeto() {
    if (!teto) return;
    setErroTeto(null);
    const r = await fetch("/api/comissoes/tetos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quemTipo: teto.quemTipo, usuarioId: teto.usuarioId || null, cargoId: teto.cargoId || null, valor: numero(teto.valor) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErroTeto(d.erro ?? "Não foi possível salvar o teto."); return; }
    toast("Teto criado.");
    setTeto(null);
    await recarregar();
  }
  async function excluirTeto(t: TetoNaTela) {
    const r = await fetch(`/api/comissoes/tetos/${t.id}`, { method: "DELETE" });
    if (!r.ok) { toast("Não foi possível excluir o teto.", "erro"); return; }
    toast("Teto excluído.");
    await recarregar();
  }
  const alternarTipoRetorno = (id: string) => setConfig((c) => ({ ...c, tiposRetorno: c.tiposRetorno.includes(id) ? c.tiposRetorno.filter((x) => x !== id) : [...c.tiposRetorno, id] }));
  const nomeDoCargo = (id: string) => dados.opcoes.cargos.find((c) => c.id === id)?.nome ?? "Cargo";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="space-y-6" data-tela-comissoes>
      <section className="card-padded space-y-4" data-config-comissoes>
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-ink">Quando a comissão fica devida</h2>
          <Dica rotulo="Quando a comissão fica devida" texto={DICA_QUANDO} />
        </div>
        <FormField label="Liberar a comissão">
          <Select value={config.quando} onChange={(e) => setConfig((c) => ({ ...c, quando: e.target.value as Quando }))} data-comissao-quando>
            {QUANDO.map((q) => <option key={q} value={q}>{ROTULO_QUANDO[q]}{q === "RECEBIMENTO" ? " (padrão)" : ""}</option>)}
          </Select>
        </FormField>
        <ToggleSwitch checked={config.liquidaImpostos} onChange={(v) => setConfig((c) => ({ ...c, liquidaImpostos: v }))}
          label="Base líquida de impostos" description="Calcula a % sobre a venda sem o ISS (o padrão é o valor com desconto)." />
        <div className="space-y-2 pt-1" data-vencimento-comissao>
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-ink">Vencimento do pagamento</h3>
            <Dica rotulo="Vencimento do pagamento" texto={DICA_VENCIMENTO} />
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3 max-w-md">
            <FormField label="Vence no mês seguinte">
              <Select value={config.vencimento.tipo} data-vencimento-tipo
                onChange={(e) => setConfig((c) => ({ ...c, vencimento: { ...c.vencimento, tipo: e.target.value as VencimentoTipo } }))}>
                {VENCIMENTO_TIPOS.map((t) => <option key={t} value={t}>{ROTULO_VENCIMENTO_TIPO[t]}</option>)}
              </Select>
            </FormField>
            <FormField label={config.vencimento.tipo === "DIA_UTIL" ? "Dia útil" : "Dia"} error={diaOk ? undefined : `De 1 a ${maxDia}.`}>
              <Input value={diaTexto} onChange={(e) => setDiaTexto(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" data-vencimento-dia error={!diaOk} />
            </FormField>
          </div>
          {diaOk && <p className="text-xs text-ink-muted" data-vencimento-resumo>{descricaoDoVencimento({ tipo: config.vencimento.tipo, dia: diaNum })}{config.vencimento.tipo === "DIA_UTIL" && diaNum === 5 ? " (padrão)" : ""}.</p>}
        </div>

        {/* COM-2: o técnico (Executor) */}
        <div className="border-t border-surface-border pt-4 space-y-4" data-config-executor>
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-ink">Comissão do técnico</h3>
            <Dica rotulo="Comissão do técnico" texto={DICA_EXECUTOR} />
          </div>
          {!temExecutor && <p className="text-xs text-ink-muted" data-sem-regra-executor>Vale quando houver uma regra com o papel Executor.</p>}
          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Liberar a comissão do técnico">
              <Select value={config.executorQuando} onChange={(e) => setConfig((c) => ({ ...c, executorQuando: e.target.value as QuandoExecutor }))} data-comissao-executor-quando>
                {QUANDO_EXECUTOR.map((q) => <option key={q} value={q}>{ROTULO_QUANDO_EXECUTOR[q]}{q === "CONCLUSAO_OS" ? " (padrão)" : ""}</option>)}
              </Select>
            </FormField>
            <FormField label="Retorno no mesmo equipamento (dias)" dica={DICA_RETORNO}>
              <Input value={String(config.retornoDias)} inputMode="numeric" maxLength={3} data-comissao-retorno-dias
                onChange={(e) => setConfig((c) => ({ ...c, retornoDias: Math.min(RETORNO_DIAS_MAX, Number(e.target.value.replace(/\D/g, "")) || 0) }))} />
            </FormField>
          </div>
          <fieldset className="space-y-2" data-tipos-retorno>
            <legend className="text-xs font-medium text-ink-muted">Tipos de OS que contam como retorno</legend>
            {dados.opcoes.tiposOs.length === 0 ? <p className="text-xs text-ink-muted">Nenhum tipo de OS cadastrado.</p> : (
              <div className="flex flex-wrap gap-2">
                {dados.opcoes.tiposOs.map((t) => {
                  const sel = config.tiposRetorno.includes(t.id);
                  return (
                    <button key={t.id} type="button" onClick={() => alternarTipoRetorno(t.id)} aria-pressed={sel} data-tipo-retorno={t.id}
                      className={cn("min-h-[36px] px-3 rounded-full text-sm border", sel ? "bg-primary-500 border-primary-500 text-white" : "bg-white border-surface-border text-ink-muted hover:border-primary-300")}>
                      {t.nome}
                    </button>
                  );
                })}
              </div>
            )}
            {config.retornoDias > 0 && config.tiposRetorno.length === 0 && (
              <p className="text-xs text-atencao-texto" data-retorno-desligado>Sem tipo marcado, a revisão de retorno fica desligada.</p>
            )}
            <p className="text-xs text-ink-muted">A mesma lista do Desempenho: mudar aqui muda lá.</p>
          </fieldset>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={salvarConfig} disabled={!mudou || !diaOk} loading={salvandoConfig} data-salvar-config-comissao>Salvar</Button>
        </div>
      </section>

      <section className="card-padded space-y-4" data-regras-comissao>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-ink">Regras</h2>
            <Dica rotulo="Qual regra vale" texto={DICA_PRECEDENCIA} />
          </div>
          <Button type="button" onClick={() => { setErro(null); setForm({ ...VAZIO }); }} data-nova-regra><Plus className="w-4 h-4" /> Nova regra</Button>
        </div>

        {/* O exemplo curto da precedência */}
        <div className="rounded-lg bg-surface-alt px-3 py-2 text-xs text-ink-muted space-y-1.5" data-exemplo-precedencia>
          <p><span className="font-semibold text-ink">Qual vale:</span> a primeira que casar, nesta ordem.</p>
          <ol className="flex flex-wrap gap-x-3 gap-y-1" data-ordem-precedencia>
            {ORDEM_PRECEDENCIA.map((o, i) => <li key={o}><span className="font-semibold text-ink tabular-nums">{i + 1}.</span> {o}</li>)}
          </ol>
          <p><span className="font-semibold text-ink">Exemplo:</span> {EXEMPLO_PRECEDENCIA}</p>
        </div>

        {dados.regras.length === 0 ? (
          <p className="text-sm text-ink-muted" data-sem-regras>Nenhuma regra. Sem regra, ninguém ganha comissão e nada de comissão aparece no sistema.</p>
        ) : (
          <ul className="divide-y divide-surface-border" data-lista-regras>
            {dados.regras.map((r) => (
              <li key={r.id} className={cn("py-3 flex flex-col sm:flex-row sm:items-center gap-2", !r.ativo && "opacity-60")} data-regra={r.id}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink font-medium">{descricaoDaRegra(r, r.nomes)}</p>
                  <p className="text-xs text-ink-muted">
                    {ROTULO_PAPEL[r.papel]} · {ROTULO_QUEM[r.quemTipo]} · {ROTULO_SOBRE[r.sobreTipo]} · {ROTULO_BASE[r.base]}: {valorDaRegra(r)}
                    {r.papel === "EXECUTOR" && (
                      <span data-divisao-regra> · {ROTULO_DIVISAO[r.divisao ?? "IGUAL"]}{r.divisao === "POR_CARGO" && r.divisaoCargos
                        ? ` (${Object.entries(r.divisaoCargos).map(([c, v]) => `${nomeDoCargo(c)} ${String(v).replace(".", ",")}%`).join(" · ")})` : ""}</span>
                    )}
                    {!r.ativo && <span className="ml-1 font-semibold">· Desativada</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => { setErro(null); setForm(paraForm(r)); }} data-editar-regra
                    className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-2 rounded text-ink-muted hover:text-primary-700 hover:bg-primary-50" aria-label="Editar regra" title="Editar">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => alternar(r)} data-alternar-regra
                    className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-2 rounded text-ink-muted hover:text-ink hover:bg-surface-alt"
                    aria-label={r.ativo ? "Desativar regra" : "Reativar regra"} title={r.ativo ? "Desativar" : "Reativar"}>
                    {r.ativo ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-padded space-y-4" data-tetos-comissao>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-ink">Teto mensal</h2>
            <Dica rotulo="Teto mensal" texto={DICA_TETO} />
          </div>
          <Button type="button" variant="secondary" onClick={() => { setErroTeto(null); setTeto({ quemTipo: "PESSOA", usuarioId: "", cargoId: "", valor: "" }); }} data-novo-teto>
            <Plus className="w-4 h-4" /> Novo teto
          </Button>
        </div>
        {dados.tetos.length === 0 ? <p className="text-sm text-ink-muted" data-sem-tetos>Sem teto: a comissão do mês é paga inteira.</p> : (
          <ul className="divide-y divide-surface-border" data-lista-tetos>
            {dados.tetos.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-2" data-teto={t.id}>
                <span className="text-sm text-ink">{t.nome} <span className="text-xs text-ink-muted">({t.quemTipo === "PESSOA" ? "pessoa" : "cargo"})</span></span>
                <span className="flex items-center gap-1">
                  <span className="text-sm tabular-nums text-ink">{t.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                  <button type="button" onClick={() => excluirTeto(t)} aria-label={`Excluir o teto de ${t.nome}`} title="Excluir" data-excluir-teto
                    className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-2 rounded text-ink-muted hover:text-atrasado hover:bg-atrasado-claro">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal aberto={!!teto} onFechar={() => setTeto(null)} titulo="Novo teto" tamanho="sm">
        {teto && (
          <div className="space-y-4" data-form-teto>
            <FormField label="Para" required>
              <Select value={teto.quemTipo} onChange={(e) => setTeto((x) => (x ? { ...x, quemTipo: e.target.value as FormTeto["quemTipo"] } : x))} data-teto-quem>
                <option value="PESSOA">Uma pessoa</option>
                <option value="CARGO">Um cargo</option>
              </Select>
            </FormField>
            {teto.quemTipo === "PESSOA" ? (
              <FormField label="Pessoa" required>
                <Select value={teto.usuarioId} onChange={(e) => setTeto((x) => (x ? { ...x, usuarioId: e.target.value } : x))} placeholder="Escolha" data-teto-pessoa>
                  {dados.opcoes.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </Select>
              </FormField>
            ) : (
              <FormField label="Cargo" required>
                <Select value={teto.cargoId} onChange={(e) => setTeto((x) => (x ? { ...x, cargoId: e.target.value } : x))} placeholder="Escolha" data-teto-cargo>
                  {dados.opcoes.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </Select>
              </FormField>
            )}
            <FormField label="Teto por mês (R$)" required>
              <Input value={teto.valor} onChange={(e) => setTeto((x) => (x ? { ...x, valor: e.target.value } : x))} inputMode="decimal" placeholder="Ex.: 1.500,00" data-teto-valor />
            </FormField>
            {erroTeto && <p role="alert" className="text-sm text-atrasado-texto" data-erro-teto>{erroTeto}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setTeto(null)}>Cancelar</Button>
              <Button type="button" onClick={salvarTeto} data-salvar-teto>Criar teto</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!form} onFechar={() => setForm(null)} titulo={form?.id ? "Editar regra" : "Nova regra"} tamanho="md">
        {form && (
          <div className="space-y-4" data-form-regra>
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Quem" required>
                <Select value={form.quemTipo} onChange={(e) => set("quemTipo", e.target.value as Quem)} data-campo-quem>
                  {QUEM.map((q) => <option key={q} value={q}>{ROTULO_QUEM[q]}</option>)}
                </Select>
              </FormField>
              {form.quemTipo === "PESSOA" && (
                <FormField label="Pessoa" required>
                  <Select value={form.usuarioId} onChange={(e) => set("usuarioId", e.target.value)} placeholder="Escolha" data-campo-pessoa>
                    {dados.opcoes.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </Select>
                </FormField>
              )}
              {form.quemTipo === "CARGO" && (
                <FormField label="Cargo" required>
                  <Select value={form.cargoId} onChange={(e) => set("cargoId", e.target.value)} placeholder="Escolha" data-campo-cargo>
                    {dados.opcoes.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </Select>
                </FormField>
              )}
              <FormField label="Papel" required>
                <Select value={form.papel} onChange={(e) => set("papel", e.target.value as Papel)} data-campo-papel>
                  {PAPEIS.map((p) => (
                    <option key={p} value={p} disabled={!(PAPEIS_ATIVOS as readonly string[]).includes(p)}>
                      {ROTULO_PAPEL[p]}{(PAPEIS_ATIVOS as readonly string[]).includes(p) ? "" : " (em breve)"}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Sobre" required>
                <Select value={form.sobreTipo} onChange={(e) => set("sobreTipo", e.target.value as Sobre)} data-campo-sobre>
                  {SOBRE.map((s) => <option key={s} value={s}>{ROTULO_SOBRE[s]}</option>)}
                </Select>
              </FormField>
              {form.sobreTipo === "CATEGORIA" && (
                <FormField label="Categoria de serviço" required hint="A categoria fica no cadastro do serviço.">
                  <Input value={form.categoria} onChange={(e) => set("categoria", e.target.value)} list="categorias-servico" maxLength={60} data-campo-categoria />
                  <datalist id="categorias-servico">{dados.opcoes.categorias.map((c) => <option key={c} value={c} />)}</datalist>
                </FormField>
              )}
              {form.sobreTipo === "SERVICO" && (
                <FormField label="Serviço" required>
                  <Select value={form.servicoId} onChange={(e) => set("servicoId", e.target.value)} placeholder="Escolha" data-campo-servico>
                    {dados.opcoes.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </Select>
                </FormField>
              )}
              <FormField label="Base" required hint={form.base === "PERC_LUCRO" ? "Calculado no servidor com o custo; o vendedor vê só o valor." : undefined}>
                <Select value={form.base} onChange={(e) => set("base", e.target.value as Base)} data-campo-base>
                  {BASES.map((b) => <option key={b} value={b}>{ROTULO_BASE[b]}</option>)}
                </Select>
              </FormField>
              <FormField label={form.base === "FIXO_ITEM" ? (form.papel === "EXECUTOR" ? "Valor por equipamento atendido (R$)" : "Valor por item (R$)") : "Percentual (%)"} required>
                <Input value={form.valor} onChange={(e) => set("valor", e.target.value)} inputMode="decimal" placeholder={form.base === "FIXO_ITEM" ? "Ex.: 15,00" : "Ex.: 5"} data-campo-valor />
              </FormField>
              {form.papel === "EXECUTOR" && (
                <FormField label="Dividir entre os técnicos" required dica={DICA_DIVISAO}>
                  <Select value={form.divisao} onChange={(e) => set("divisao", e.target.value as Divisao)} data-campo-divisao>
                    {DIVISOES.map((d) => <option key={d} value={d}>{ROTULO_DIVISAO[d]}</option>)}
                  </Select>
                </FormField>
              )}
            </div>
            {form.papel === "EXECUTOR" && form.divisao === "POR_CARGO" && (
              <fieldset className="space-y-2" data-divisao-cargos>
                <legend className="text-xs font-medium text-ink-muted">% de cada cargo (conta só quem estiver na atividade)</legend>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {dados.opcoes.cargos.map((c) => (
                    <label key={c.id} className="text-xs text-ink-muted space-y-1"><span className="block truncate">{c.nome}</span>
                      <Input value={form.divisaoCargos[c.id] ?? ""} inputMode="decimal" placeholder="0" aria-label={`% do cargo ${c.nome}`} data-divisao-cargo={c.id}
                        onChange={(e) => set("divisaoCargos", { ...form.divisaoCargos, [c.id]: e.target.value })} />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {erro && <p role="alert" className="text-sm text-atrasado-texto" data-erro-regra>{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button type="button" onClick={salvarRegra} loading={salvando} data-salvar-regra>{form.id ? "Salvar" : "Criar regra"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
