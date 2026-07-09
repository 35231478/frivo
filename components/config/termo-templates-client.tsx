"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { cn, VARIAVEIS_TERMO } from "@/lib/utils";
import { Plus, Pencil, Trash2, Check, FileText, Search } from "lucide-react";

interface Termo {
  id: string;
  nome: string;
  descricao?: string | null;
  conteudo: string;
  ativo: boolean;
}

export function TermoTemplatesClient() {
  const [itens, setItens] = useState<Termo[]>([]);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState<{ nome: string; descricao: string; conteudo: string }>({ nome: "", descricao: "", conteudo: "" });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/termo-templates").then((r) => r.json()).then(setItens).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function abrirNovo() {
    setForm({ nome: "", descricao: "", conteudo: "" });
    setEditando("novo");
    setErro("");
  }
  function abrirEditar(t: Termo) {
    setForm({ nome: t.nome, descricao: t.descricao ?? "", conteudo: t.conteudo ?? "" });
    setEditando(t.id);
    setErro("");
  }
  function cancelar() { setEditando(null); setErro(""); }

  function inserirVariavel(v: string) {
    const ta = textareaRef.current;
    if (!ta) { setForm((f) => ({ ...f, conteudo: `${f.conteudo}${f.conteudo && !f.conteudo.endsWith(" ") ? " " : ""}${v}` })); return; }
    const start = ta.selectionStart ?? form.conteudo.length;
    const end = ta.selectionEnd ?? form.conteudo.length;
    const novo = form.conteudo.slice(0, start) + v + form.conteudo.slice(end);
    setForm((f) => ({ ...f, conteudo: novo }));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + v.length; });
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro("Nome é obrigatório."); return; }
    setSalvando(true); setErro("");
    try {
      if (editando === "novo") {
        const res = await fetch("/api/termo-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar."); return; }
        const novo = await res.json();
        setItens((p) => [...p, novo]);
      } else {
        const res = await fetch(`/api/termo-templates/${editando}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar."); return; }
        const atualizado = await res.json();
        setItens((p) => p.map((i) => (i.id === editando ? atualizado : i)));
      }
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!confirm("Desativar este termo?")) return;
    try {
      await fetch(`/api/termo-templates/${id}`, { method: "DELETE" });
      setItens((p) => p.map((i) => (i.id === id ? { ...i, ativo: false } : i)));
    } catch {}
  }

  const ativos = itens.filter((i) => i.ativo !== false);
  const q = busca.trim().toLowerCase();
  const filtrados = q ? ativos.filter((t) => t.nome.toLowerCase().includes(q) || (t.descricao ?? "").toLowerCase().includes(q)) : ativos;
  const termoEditando = editando && editando !== "novo" ? itens.find((i) => i.id === editando) : null;

  return (
    <div className="space-y-4">
      {/* Barra: busca + Novo */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar termo..." className="pl-9" />
        </div>
        <Button type="button" onClick={abrirNovo} className="ml-auto shrink-0">
          <Plus className="w-4 h-4" /> Novo termo
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>
      ) : (
        <div className="border border-surface-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden sm:table-cell">Descrição</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider w-24">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={3} className="text-center text-ink-subtle py-10">{q ? "Nenhum termo encontrado." : "Nenhum termo cadastrado."}</td></tr>
              ) : filtrados.map((t, idx) => (
                <tr key={t.id} className={cn("border-b border-surface-border last:border-0 hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
                  <td className="px-4 py-3 font-medium text-ink"><span className="inline-flex items-center gap-2"><FileText className="w-4 h-4 text-primary-600" /> {t.nome}</span></td>
                  <td className="px-4 py-3 text-ink-muted hidden sm:table-cell">{t.descricao || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => abrirEditar(t)} className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded transition-colors" title="Editar"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => remover(t.id)} className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Desativar"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer de cadastro/edição */}
      <Drawer
        aberto={!!editando}
        onFechar={cancelar}
        titulo={editando === "novo" ? "Novo termo" : `Editar ${termoEditando?.nome ?? "termo"}`}
        largura="w-full sm:w-[60vw] sm:min-w-[520px] sm:max-w-[880px]"
        rodape={
          <>
            <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Adicionar" : "Salvar"}</Button>
          </>
        }
      >
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">{erro}</div>}
        <div className="space-y-4">
          <FormField label="Nome" required>
            <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex.: Termo Contrato Anual" />
          </FormField>
          <FormField label="Descrição">
            <Input value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} placeholder="Resumo do uso deste termo" />
          </FormField>
          <div>
            <p className="text-sm font-semibold text-ink mb-1.5">Variáveis (clique para inserir)</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {VARIAVEIS_TERMO.map((v) => (
                <button key={v} type="button" onClick={() => inserirVariavel(v)}
                  className="inline-flex items-center gap-1 text-[11px] font-mono bg-primary-50 text-primary-700 border border-primary-100 rounded px-2 py-1 hover:bg-primary-100 transition-colors">
                  {v}
                </button>
              ))}
            </div>
          </div>
          <FormField label="Conteúdo do termo">
            <Textarea ref={textareaRef} value={form.conteudo} onChange={(e) => setForm((f) => ({ ...f, conteudo: e.target.value }))} rows={12}
              placeholder="Ex.: A CONTRATADA prestará serviços de manutenção para {{cliente_nome}}..." />
          </FormField>
        </div>
      </Drawer>
    </div>
  );
}
