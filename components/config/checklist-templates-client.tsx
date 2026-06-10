"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, X, Check, GripVertical } from "lucide-react";

const FREQUENCIAS = [{ v: "DIARIO", l: "Diário" }, { v: "SEMANAL", l: "Semanal" }, { v: "MENSAL", l: "Mensal" }];
const TIPOS_ITEM = [
  { v: "OK_NOK", l: "OK / NOK" },
  { v: "NIVEL", l: "Níveis (opções)" },
  { v: "TEXTO", l: "Texto livre" },
  { v: "FOTO", l: "Foto" },
];

interface ItemForm { categoria: string; descricao: string; tipo: string; opcoesStr: string; obrigatorio: boolean }

const ITEM_VAZIO: ItemForm = { categoria: "", descricao: "", tipo: "OK_NOK", opcoesStr: "OK, NOK", obrigatorio: true };

export function ChecklistTemplatesClient() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [frequencia, setFrequencia] = useState("DIARIO");
  const [itens, setItens] = useState<ItemForm[]>([]);

  useEffect(() => {
    fetch("/api/checklist-templates").then((r) => r.json()).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function abrirNovo() {
    setNome(""); setDescricao(""); setFrequencia("DIARIO"); setItens([{ ...ITEM_VAZIO }]);
    setEditando("novo"); setErro("");
  }
  function abrirEditar(t: any) {
    setNome(t.nome); setDescricao(t.descricao ?? ""); setFrequencia(t.frequencia);
    setItens((t.itens ?? []).map((i: any) => ({
      categoria: i.categoria, descricao: i.descricao, tipo: i.tipo,
      opcoesStr: (i.opcoes ?? []).join(", "), obrigatorio: i.obrigatorio,
    })));
    setEditando(t.id); setErro("");
  }

  function addItem() { setItens((p) => [...p, { ...ITEM_VAZIO, categoria: p[p.length - 1]?.categoria ?? "" }]); }
  function updItem(i: number, k: keyof ItemForm, v: any) { setItens((p) => p.map((it, idx) => (idx === i ? { ...it, [k]: v } : it))); }
  function removeItem(i: number) { setItens((p) => p.filter((_, idx) => idx !== i)); }
  function moverItem(i: number, dir: -1 | 1) {
    setItens((p) => {
      const n = [...p]; const j = i + dir;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  }

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Nome do template é obrigatório."); return; }
    if (itens.length === 0) { setErro("Adicione ao menos um item."); return; }
    if (itens.some((i) => !i.descricao.trim() || !i.categoria.trim())) { setErro("Preencha categoria e descrição de todos os itens."); return; }
    setSalvando(true);
    const payload = {
      nome, descricao, frequencia,
      itens: itens.map((i, idx) => ({
        categoria: i.categoria, descricao: i.descricao, tipo: i.tipo,
        opcoes: (i.tipo === "OK_NOK" || i.tipo === "NIVEL") ? i.opcoesStr.split(",").map((s) => s.trim()).filter(Boolean) : [],
        obrigatorio: i.obrigatorio, ordem: idx,
      })),
    };
    try {
      const url = editando === "novo" ? "/api/checklist-templates" : `/api/checklist-templates/${editando}`;
      const res = await fetch(url, { method: editando === "novo" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar."); return; }
      const salvo = await res.json();
      setTemplates((p) => editando === "novo" ? [...p, salvo] : p.map((t) => (t.id === editando ? salvo : t)));
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!confirm("Desativar este template?")) return;
    await fetch(`/api/checklist-templates/${id}`, { method: "DELETE" });
    setTemplates((p) => p.map((t) => (t.id === id ? { ...t, ativo: false } : t)));
  }

  const ativos = templates.filter((t) => t.ativo !== false);

  return (
    <div className="space-y-4">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {loading ? (
        <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>
      ) : editando ? null : (
        <div className="space-y-2">
          {ativos.length === 0 && <p className="text-sm text-ink-subtle text-center py-8">Nenhum template cadastrado.</p>}
          {ativos.map((t) => (
            <div key={t.id} className="flex items-center justify-between border border-surface-border rounded-lg px-4 py-3">
              <div>
                <p className="font-medium text-ink">{t.nome}</p>
                <p className="text-xs text-ink-muted">{FREQUENCIAS.find((f) => f.v === t.frequencia)?.l} · {t._count?.itens ?? t.itens?.length ?? 0} itens · {t._count?.preenchidos ?? 0} preenchimentos</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => abrirEditar(t)} className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded" title="Editar"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remover(t.id)} className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded" title="Desativar"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={abrirNovo} className="w-full justify-center border-dashed">
            <Plus className="w-4 h-4" /> Novo template de checklist
          </Button>
        </div>
      )}

      {editando && (
        <div className="border border-primary-200 bg-primary-50/20 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-700">{editando === "novo" ? "Novo template" : "Editar template"}</h4>
            <button onClick={() => setEditando(null)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
          </div>
          <FormGrid cols={3}>
            <FormField label="Nome" required className="sm:col-span-2"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Checklist Diário" /></FormField>
            <FormField label="Frequência"><Select value={frequencia} onChange={(e) => setFrequencia(e.target.value)}>{FREQUENCIAS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}</Select></FormField>
          </FormGrid>
          <FormField label="Descrição"><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></FormField>

          <div className="space-y-2">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Itens</p>
            {itens.map((it, i) => (
              <div key={i} className="border border-surface-border bg-white rounded-lg p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moverItem(i, -1)} className="text-ink-subtle hover:text-ink leading-none"><GripVertical className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                    <Input value={it.categoria} onChange={(e) => updItem(i, "categoria", e.target.value)} placeholder="Categoria (ex: Motor)" />
                    <Input value={it.descricao} onChange={(e) => updItem(i, "descricao", e.target.value)} placeholder="Item (ex: Nível do óleo)" />
                  </div>
                  <button type="button" onClick={() => removeItem(i)} className="text-red-500 hover:text-red-700 p-1.5 shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:pl-6">
                  <Select value={it.tipo} onChange={(e) => updItem(i, "tipo", e.target.value)}>{TIPOS_ITEM.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</Select>
                  {(it.tipo === "OK_NOK" || it.tipo === "NIVEL") && (
                    <Input value={it.opcoesStr} onChange={(e) => updItem(i, "opcoesStr", e.target.value)} placeholder="Opções separadas por vírgula" className="sm:col-span-2" />
                  )}
                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    <input type="checkbox" checked={it.obrigatorio} onChange={(e) => updItem(i, "obrigatorio", e.target.checked)} className="rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                    Obrigatório
                  </label>
                </div>
                <p className="text-[11px] text-ink-subtle sm:pl-6">A primeira opção é considerada o estado saudável; as demais geram alerta.</p>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={addItem} className="w-full justify-center border-dashed"><Plus className="w-4 h-4" /> Adicionar item</Button>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
            <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Criar template" : "Salvar"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
