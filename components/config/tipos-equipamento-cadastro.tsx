"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import {
  Plus, Pencil, Trash2, X, Check, Search, FileText, Settings2, AlertTriangle, Loader2, Boxes,
} from "lucide-react";

interface Equip { id: string; nome: string; descricao: string | null; ativo?: boolean }
interface FormOpt { id: string; nome: string; ativo?: boolean; campos?: { id: string }[] }
interface TipoOsOpt { id: string; nome: string; cor: string; ativo?: boolean }
interface Vinculo {
  id?: string;
  _tempId?: string;
  formularioTemplateId: string;
  tipoOsId: string;
  obrigatorioConcluir: boolean;
  obrigatorioImpedimento: boolean;
  formulario: { id: string; nome: string; qtdPerguntas: number };
  tipoOs: { id: string; nome: string; cor: string } | null;
}

const ativos = <T extends { ativo?: boolean }>(l: T[]) => l.filter((o) => o.ativo !== false);

export function TiposEquipamentoCadastro() {
  const [itens, setItens] = useState<Equip[]>([]);
  const [formOpts, setFormOpts] = useState<FormOpt[]>([]);
  const [tiposOs, setTiposOs] = useState<TipoOsOpt[]>([]);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [equipId, setEquipId] = useState<string | null>(null); // id real quando editando persistido
  const [aba, setAba] = useState<"geral" | "formularios">("geral");
  const [form, setForm] = useState<{ nome: string; descricao: string }>({ nome: "", descricao: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    fetch("/api/tipos-equipamento").then((r) => r.json()).then((d) => setItens(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/formularios").then((r) => r.json()).then((d) => setFormOpts(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/tipos-os").then((r) => r.json()).then((d) => setTiposOs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  function abrirNovo() {
    setForm({ nome: "", descricao: "" });
    setEditando("novo"); setEquipId(null); setAba("geral"); setErro("");
  }
  function abrirEditar(e: Equip) {
    setForm({ nome: e.nome, descricao: e.descricao ?? "" });
    setEditando(e.id); setEquipId(e.id); setAba("geral"); setErro("");
  }
  function fechar() { setEditando(null); setEquipId(null); setErro(""); }

  async function salvarGeral() {
    if (!form.nome.trim()) { setErro("Nome do tipo de equipamento é obrigatório."); return; }
    setSalvando(true); setErro("");
    try {
      const novo = editando === "novo";
      const res = await fetch(novo ? "/api/tipos-equipamento" : `/api/tipos-equipamento/${editando}`, {
        method: novo ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: form.nome.trim(), descricao: form.descricao.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data?.erro ?? "Erro ao salvar."); return; }
      if (novo) {
        setItens((p) => [...p, data]);
        setEditando(data.id); setEquipId(data.id); // habilita aba Formulários
      } else {
        setItens((p) => p.map((i) => (i.id === editando ? { ...i, ...data } : i)));
      }
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(e: Equip) {
    if (!confirm(`Remover o tipo de equipamento "${e.nome}"?`)) return;
    const res = await fetch(`/api/tipos-equipamento/${e.id}`, { method: "DELETE" });
    if (res.ok) setItens((p) => p.filter((x) => x.id !== e.id));
  }

  const q = busca.trim().toLowerCase();
  const itensFiltrados = q
    ? itens.filter((e) => e.nome.toLowerCase().includes(q) || (e.descricao ?? "").toLowerCase().includes(q))
    : itens;

  return (
    <div className="space-y-4">
      {/* Barra: busca + Novo */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar tipo de equipamento..." className="pl-9" />
        </div>
        <Button type="button" onClick={abrirNovo} className="ml-auto shrink-0">
          <Plus className="w-4 h-4" /> Novo tipo de equipamento
        </Button>
      </div>

      {/* Lista full-width */}
      <div className="border border-surface-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt border-b border-surface-border">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Nome</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden sm:table-cell">Observações</th>
              <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider w-24">Ações</th>
            </tr>
          </thead>
          <tbody>
            {itensFiltrados.length === 0 ? (
              <tr><td colSpan={3} className="text-center text-ink-subtle py-10">{busca ? "Nenhum tipo encontrado." : "Nenhum tipo de equipamento cadastrado ainda."}</td></tr>
            ) : itensFiltrados.map((e, idx) => (
              <tr key={e.id} className={cn("border-b border-surface-border last:border-0 hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
                <td className="px-4 py-3 font-medium text-ink">{e.nome}</td>
                <td className="px-4 py-3 text-ink-muted hidden sm:table-cell">{e.descricao || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => abrirEditar(e)} title="Editar" className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remover(e)} title="Remover" className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drawer de cadastro/edição com abas Geral + Formulários */}
      <Drawer
        aberto={!!editando}
        onFechar={fechar}
        titulo={editando === "novo" ? "Novo tipo de equipamento" : (form.nome || "Editar tipo de equipamento")}
        abas={[{ id: "geral", label: "Geral", icone: Settings2 }, { id: "formularios", label: "Formulários", icone: FileText }]}
        abaAtiva={aba}
        onAbaChange={(id) => setAba(id as "geral" | "formularios")}
        rodape={aba === "geral" ? (
          <>
            <Button type="button" variant="secondary" onClick={fechar}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvarGeral}><Check className="w-4 h-4" /> Salvar</Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={fechar}>Fechar</Button>
        )}
      >
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">{erro}</div>}

        {aba === "geral" ? (
          <div className="space-y-4">
            <FormField label="Nome do equipamento" required>
              <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex: Split, Chiller, VRF" />
            </FormField>
            <FormField label="Observações">
              <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={4} placeholder="Observações sobre este tipo de equipamento" />
            </FormField>
          </div>
        ) : (
          equipId ? (
            <FormulariosVinculados equipId={equipId} formOpts={ativos(formOpts)} tiposOs={ativos(tiposOs)} />
          ) : (
            <p className="text-sm text-ink-muted py-4">Salve o tipo de equipamento na aba <strong>Geral</strong> para vincular formulários.</p>
          )
        )}
      </Drawer>
    </div>
  );
}

// ─────────────────────────────────────────────
// Aba Formulários — gerencia os vínculos (FormTypeMapping) do equipamento
// ─────────────────────────────────────────────
function FormulariosVinculados({ equipId, formOpts, tiposOs }: { equipId: string; formOpts: FormOpt[]; tiposOs: TipoOsOpt[] }) {
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    setVinculos(null);
    fetch(`/api/tipos-equipamento/${equipId}/formularios`)
      .then((r) => r.json())
      .then((d) => { if (!cancelado) setVinculos(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelado) setVinculos([]); });
    return () => { cancelado = true; };
  }, [equipId]);

  const base = `/api/tipos-equipamento/${equipId}/formularios`;
  const keyOf = (v: Vinculo) => v.id ?? v._tempId!;

  function addFormulario(opt: FormOpt) {
    setBusca("");
    setVinculos((v) => [
      ...(v ?? []),
      {
        _tempId: crypto.randomUUID(),
        formularioTemplateId: opt.id,
        tipoOsId: "",
        obrigatorioConcluir: false,
        obrigatorioImpedimento: false,
        formulario: { id: opt.id, nome: opt.nome, qtdPerguntas: opt.campos?.length ?? 0 },
        tipoOs: null,
      },
    ]);
  }

  function atualizarLocal(chave: string, patch: Partial<Vinculo>) {
    setVinculos((v) => (v ?? []).map((x) => (keyOf(x) === chave ? { ...x, ...patch } : x)));
  }

  async function selecionarTipoOs(row: Vinculo, tipoOsId: string) {
    setErro("");
    const chave = keyOf(row);
    const to = tiposOs.find((t) => t.id === tipoOsId) ?? null;
    if (row.id) {
      const prev = row.tipoOsId;
      atualizarLocal(chave, { tipoOsId, tipoOs: to });
      const res = await fetch(`${base}/${row.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipoOsId }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Erro ao atualizar."); atualizarLocal(chave, { tipoOsId: prev, tipoOs: tiposOs.find((t) => t.id === prev) ?? null }); }
    } else {
      // pending → cria o vínculo (precisa do tipo de OS)
      atualizarLocal(chave, { tipoOsId, tipoOs: to });
      const res = await fetch(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formularioTemplateId: row.formularioTemplateId, tipoOsId, obrigatorioConcluir: row.obrigatorioConcluir, obrigatorioImpedimento: row.obrigatorioImpedimento }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data?.erro ?? "Erro ao vincular."); atualizarLocal(chave, { tipoOsId: "", tipoOs: null }); return; }
      setVinculos((v) => (v ?? []).map((x) => (keyOf(x) === chave ? data : x)));
    }
  }

  async function toggleFlag(row: Vinculo, campo: "obrigatorioConcluir" | "obrigatorioImpedimento") {
    if (!row.id) return; // precisa estar persistido (tipo de OS selecionado)
    const chave = keyOf(row);
    const valor = !row[campo];
    atualizarLocal(chave, { [campo]: valor } as Partial<Vinculo>);
    const res = await fetch(`${base}/${row.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [campo]: valor }),
    });
    if (!res.ok) atualizarLocal(chave, { [campo]: !valor } as Partial<Vinculo>);
  }

  async function remover(row: Vinculo) {
    const chave = keyOf(row);
    if (row.id) {
      const res = await fetch(`${base}/${row.id}`, { method: "DELETE" });
      if (!res.ok) return;
    }
    setVinculos((v) => (v ?? []).filter((x) => keyOf(x) !== chave));
  }

  const jaVinculadosIds = new Set((vinculos ?? []).map((v) => v.formularioTemplateId));
  const sugestoes = busca.trim()
    ? formOpts.filter((o) => o.nome.toLowerCase().includes(busca.trim().toLowerCase())).slice(0, 8)
    : [];

  if (vinculos === null) {
    return <div className="flex items-center gap-2 text-sm text-ink-muted py-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando formulários…</div>;
  }

  return (
    <div className="space-y-3">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {/* Busca de formulário */}
      <div className="relative">
        <div className="relative">
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar formulário..." className="pl-9" />
        </div>
        {sugestoes.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-surface-border rounded-lg shadow-card-hover py-1 max-h-64 overflow-y-auto">
            {sugestoes.map((o) => (
              <button
                key={o.id} type="button" onClick={() => addFormulario(o)}
                className="flex items-center justify-between gap-2 w-full px-3 py-2 text-sm text-ink hover:bg-surface-alt text-left"
              >
                <span className="flex items-center gap-2 min-w-0"><FileText className="w-3.5 h-3.5 text-ink-subtle shrink-0" /> <span className="truncate">{o.nome}</span></span>
                <span className="text-xs text-ink-subtle shrink-0">{o.campos?.length ?? 0} pergunta{(o.campos?.length ?? 0) === 1 ? "" : "s"}</span>
                {jaVinculadosIds.has(o.id) && <Check className="w-3.5 h-3.5 text-success-600 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Formulários vinculados */}
      {vinculos.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-surface-border rounded-xl">
          <Boxes className="w-6 h-6 text-ink-subtle mx-auto mb-2" />
          <p className="text-sm text-ink-muted">Nenhum formulário vinculado. Pesquise acima para adicionar.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {vinculos.map((v) => (
            <div key={v.id ?? v._tempId} className="border border-surface-border rounded-lg p-3 space-y-2.5 bg-white">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary-600 shrink-0" />
                  {v.formulario.nome}
                  <span className="text-xs font-normal text-ink-subtle">({v.formulario.qtdPerguntas} pergunta{v.formulario.qtdPerguntas === 1 ? "" : "s"})</span>
                </p>
                <button type="button" onClick={() => remover(v)} title="Remover formulário" className="p-1 text-ink-subtle hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="sm:w-56">
                  <Select value={v.tipoOsId} onChange={(e) => selecionarTipoOs(v, e.target.value)} placeholder="Tipo de OS…">
                    {tiposOs.map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                  </Select>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <ChipToggle
                    ativo={v.obrigatorioConcluir}
                    disabled={!v.id}
                    onClick={() => toggleFlag(v, "obrigatorioConcluir")}
                    cor="verde"
                    icone={<Check className="w-3.5 h-3.5" />}
                    label="Obrigatório para concluir a visita"
                  />
                  <ChipToggle
                    ativo={v.obrigatorioImpedimento}
                    disabled={!v.id}
                    onClick={() => toggleFlag(v, "obrigatorioImpedimento")}
                    cor="ambar"
                    icone={<AlertTriangle className="w-3.5 h-3.5" />}
                    label="Obrigatório para registrar impedimento"
                  />
                </div>
              </div>
              {!v.id && <p className="text-xs text-amber-600">Selecione o tipo de OS para salvar este vínculo.</p>}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-ink-subtle">Cada tipo de OS pode ter um formulário por equipamento. Os formulários são criados em <strong>Formulários</strong>.</p>
    </div>
  );
}

function ChipToggle({ ativo, disabled, onClick, cor, icone, label }: {
  ativo: boolean; disabled?: boolean; onClick: () => void; cor: "verde" | "ambar"; icone: React.ReactNode; label: string;
}) {
  const on = cor === "verde" ? "bg-success-50 border-success-300 text-success-700" : "bg-amber-50 border-amber-300 text-amber-700";
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={label}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors",
        ativo ? on : "bg-white border-surface-border text-ink-muted hover:bg-surface-alt",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {icone}
      <span className="hidden md:inline">{label}</span>
      <span className="md:hidden">{cor === "verde" ? "Concluir" : "Impedimento"}</span>
    </button>
  );
}
