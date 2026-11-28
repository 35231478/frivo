"use client";

import { useState } from "react";
import { Pencil, Plus, Power, PowerOff } from "lucide-react";
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
  BASES, PAPEIS, PAPEIS_ATIVOS, QUANDO, QUEM, ROTULO_BASE, ROTULO_PAPEL, ROTULO_QUANDO, ROTULO_QUEM, ROTULO_SOBRE, SOBRE, descricaoDaRegra,
  type Base, type Papel, type Quando, type Quem, type RegraComissao, type Sobre,
} from "@/lib/comissoes/regras";

export interface RegraNaTela extends RegraComissao { ativo: boolean; nomes: { pessoa: string | null; cargo: string | null; servico: string | null } }
export interface TelaComissoesDados {
  regras: RegraNaTela[];
  config: { quando: Quando; liquidaImpostos: boolean };
  opcoes: { pessoas: { id: string; nome: string }[]; cargos: { id: string; nome: string }[]; servicos: { id: string; nome: string }[]; categorias: string[] };
}

const DICA_PRECEDENCIA = "A regra mais específica vence. Primeiro quem: pessoa vence cargo, que vence todos. "
  + "Depois, no mesmo quem: um serviço vence a categoria, que vence todos os serviços. Peças só valem para as linhas de peça.";
const DICA_QUANDO = "No recebimento: cada parcela paga libera a parte proporcional da comissão. Na aprovação ou na conclusão da OS: "
  + "libera tudo de uma vez. A comissão nasce na aprovação e guarda a regra daquele dia: mudar aqui não mexe no passado.";

type Form = { id?: string; quemTipo: Quem; usuarioId: string; cargoId: string; papel: Papel; sobreTipo: Sobre; categoria: string; servicoId: string; base: Base; valor: string };
const VAZIO: Form = { quemTipo: "TODOS", usuarioId: "", cargoId: "", papel: "VENDEDOR", sobreTipo: "TODOS_SERVICOS", categoria: "", servicoId: "", base: "PERC_VENDA", valor: "" };

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
  const mudou = config.quando !== dados.config.quando || config.liquidaImpostos !== dados.config.liquidaImpostos;

  async function recarregar() {
    const r = await fetch("/api/comissoes");
    if (r.ok) setDados(await r.json());
  }

  async function salvarConfig() {
    setSalvandoConfig(true);
    try {
      const r = await fetch("/api/comissoes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível salvar.", "erro"); return; }
      setDados((x) => ({ ...x, config }));
      toast("Configuração das comissões salva.");
    } finally { setSalvandoConfig(false); }
  }

  async function gravar(f: Form, extra: { ativo?: boolean } = {}) {
    const corpo = {
      quemTipo: f.quemTipo, usuarioId: f.usuarioId || null, cargoId: f.cargoId || null, papel: f.papel, sobreTipo: f.sobreTipo,
      categoria: f.categoria || null, servicoId: f.servicoId || null, base: f.base, valor: Number(String(f.valor).replace(",", ".")), ...extra,
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
  });
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
        <div className="flex justify-end">
          <Button type="button" onClick={salvarConfig} disabled={!mudou} loading={salvandoConfig} data-salvar-config-comissao>Salvar</Button>
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
        <div className="rounded-lg bg-surface-alt px-3 py-2 text-xs text-ink-muted" data-exemplo-precedencia>
          <span className="font-semibold text-ink">Exemplo:</span> “Ana (pessoa) · Limpeza · 10%” vence “Vendedores (cargo) · Manutenção · 5%”.
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
              <FormField label={form.base === "FIXO_ITEM" ? "Valor por item (R$)" : "Percentual (%)"} required>
                <Input value={form.valor} onChange={(e) => set("valor", e.target.value)} inputMode="decimal" placeholder={form.base === "FIXO_ITEM" ? "Ex.: 15,00" : "Ex.: 5"} data-campo-valor />
              </FormField>
            </div>
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
