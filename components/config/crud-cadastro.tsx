"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, Check, Search } from "lucide-react";

export interface CampoConfig {
  key: string;
  label: string;
  tipo?: "text" | "textarea" | "number" | "color" | "select";
  placeholder?: string;
  opcoes?: { value: string; label: string }[];
  obrigatorio?: boolean;
  formato?: "moeda";
}

interface CrudCadastroProps {
  titulo: string;
  apiUrl: string;
  campos: CampoConfig[];
  colunasLista: { key: string; label: string; render?: (item: any) => React.ReactNode }[];
}

export function CrudCadastro({ titulo, apiUrl, campos, colunasLista }: CrudCadastroProps) {
  const [itens, setItens] = useState<any[]>([]);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    fetch(apiUrl).then((r) => r.json()).then(setItens).catch(() => {}).finally(() => setLoading(false));
  }, [apiUrl]);

  function abrirNovo() {
    const vazio: Record<string, any> = {};
    campos.forEach((c) => { vazio[c.key] = c.tipo === "color" ? "#3b82f6" : ""; });
    vazio.ativo = true;
    setForm(vazio);
    setEditando("novo");
    setErro("");
  }

  function abrirEditar(item: any) {
    const vals: Record<string, any> = {};
    campos.forEach((c) => { vals[c.key] = item[c.key] ?? (c.tipo === "color" ? "#3b82f6" : ""); });
    vals.ativo = item.ativo;
    setForm(vals);
    setEditando(item.id);
    setErro("");
  }

  function cancelar() { setEditando(null); setErro(""); }

  async function salvar() {
    const obrigatorios = campos.filter((c) => c.obrigatorio);
    for (const c of obrigatorios) {
      if (!form[c.key]) { setErro(`${c.label} é obrigatório.`); return; }
    }
    setSalvando(true); setErro("");

    const payload = { ...form };
    campos.forEach((c) => {
      if (c.tipo === "number" && payload[c.key] !== "" && payload[c.key] !== undefined) {
        payload[c.key] = Number(payload[c.key]);
      }
    });

    try {
      if (editando === "novo") {
        const res = await fetch(apiUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar."); return; }
        const novo = await res.json();
        setItens((p) => [...p, novo]);
      } else {
        const res = await fetch(`${apiUrl}/${editando}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar."); return; }
        const atualizado = await res.json();
        setItens((p) => p.map((i) => (i.id === editando ? atualizado : i)));
      }
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!confirm("Desativar este item?")) return;
    try {
      await fetch(`${apiUrl}/${id}`, { method: "DELETE" });
      setItens((p) => p.map((i) => (i.id === id ? { ...i, ativo: false } : i)));
    } catch {}
  }

  const ativos = itens.filter((i) => i.ativo !== false);
  const inativos = itens.filter((i) => i.ativo === false);
  const q = busca.trim().toLowerCase();
  const filtrados = q
    ? ativos.filter((i) => colunasLista.some((c) => String(i[c.key] ?? "").toLowerCase().includes(q)))
    : ativos;
  const itemEditando = editando && editando !== "novo" ? itens.find((i) => i.id === editando) : null;

  return (
    <div className="space-y-4">
      {/* Barra: busca + Novo */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar ${titulo.toLowerCase()}...`} className="pl-9" />
        </div>
        <Button type="button" onClick={abrirNovo} className="ml-auto shrink-0">
          <Plus className="w-4 h-4" /> Novo {titulo.toLowerCase()}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>
      ) : (
        <>
          {/* Tabela */}
          <div className="border border-surface-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt border-b border-surface-border">
                <tr>
                  {colunasLista.map((col) => (
                    <th key={col.key} className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">{col.label}</th>
                  ))}
                  <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider w-24">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 && (
                  <tr><td colSpan={colunasLista.length + 1} className="text-center text-ink-subtle py-10">{q ? "Nenhum item encontrado." : "Nenhum item cadastrado."}</td></tr>
                )}
                {filtrados.map((item, idx) => (
                  <tr key={item.id} className={cn(
                    "border-b border-surface-border last:border-0 hover:bg-primary-50/40 transition-colors",
                    idx % 2 === 1 && "bg-surface-alt/30",
                  )}>
                    {colunasLista.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-ink">
                        {col.render ? col.render(item) : String(item[col.key] ?? "—")}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => abrirEditar(item)} className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded transition-colors" title="Editar"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => remover(item.id)} className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Desativar"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {inativos.length > 0 && (
            <details className="text-xs text-ink-subtle">
              <summary className="cursor-pointer hover:text-ink-muted">{inativos.length} item(ns) inativo(s)</summary>
              <div className="mt-2 space-y-1">
                {inativos.map((i) => (
                  <div key={i.id} className="flex items-center justify-between px-3 py-1.5 bg-surface-alt rounded">
                    <span className="line-through">{i.nome}</span>
                    <button onClick={() => { fetch(`${apiUrl}/${i.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: true }) }).then(() => setItens((p) => p.map((x) => (x.id === i.id ? { ...x, ativo: true } : x)))); }}
                      className="text-primary-600 hover:underline font-medium">Reativar</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {/* Drawer de cadastro/edição */}
      <Drawer
        aberto={!!editando}
        onFechar={cancelar}
        titulo={editando === "novo" ? `Novo ${titulo.toLowerCase()}` : `Editar ${itemEditando?.nome ?? titulo.toLowerCase()}`}
        rodape={
          <>
            <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Adicionar" : "Salvar"}</Button>
          </>
        }
      >
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">{erro}</div>}
        <div className="space-y-4">
          {campos.map((c) => (
            <FormField key={c.key} label={c.label} required={c.obrigatorio}>
              {c.tipo === "textarea" ? (
                <Textarea value={form[c.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))} placeholder={c.placeholder} rows={3} />
              ) : c.tipo === "color" ? (
                <div className="flex items-center gap-2">
                  <input type="color" value={form[c.key] ?? "#3b82f6"} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))} className="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
                  <Input value={form[c.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))} className="flex-1 font-mono text-xs" />
                </div>
              ) : c.tipo === "select" && c.opcoes ? (
                <select value={form[c.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                  className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
                  <option value="">Selecione</option>
                  {c.opcoes.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              ) : (
                <Input
                  type={c.tipo === "number" ? "number" : "text"}
                  step={c.tipo === "number" ? "0.01" : undefined}
                  value={form[c.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                  placeholder={c.placeholder}
                />
              )}
            </FormField>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
