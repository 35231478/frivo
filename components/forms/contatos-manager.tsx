"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { WhatsAppInput } from "@/components/ui/whatsapp-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { LABELS_TIPO_CONTATO } from "@/lib/utils";
import type { ContatoCliente } from "@prisma/client";
import { Plus, Pencil, Trash2, X, Check, UserCircle, ChevronDown, ChevronRight, Star, Phone, Mail } from "lucide-react";

interface ContatoFormData {
  nome: string;
  cargo: string;
  tipo: string;
  telefone: string;
  whatsapp: string;
  email: string;
  principal: boolean;
}

const emptyForm: ContatoFormData = {
  nome: "", cargo: "", tipo: "OUTRO", telefone: "", whatsapp: "", email: "", principal: false,
};

interface ContatosManagerProps {
  clienteId: string;
  contatosIniciais: ContatoCliente[];
}

export function ContatosManager({ clienteId, contatosIniciais }: ContatosManagerProps) {
  const [contatos, setContatos] = useState<ContatoCliente[]>(contatosIniciais);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<ContatoFormData>(emptyForm);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  function toggleExpand(id: string) {
    setExpandido((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function abrirNovo() {
    setForm({ ...emptyForm, principal: contatos.length === 0 });
    setEditando("novo");
    setErro("");
  }

  function abrirEditar(c: ContatoCliente) {
    setForm({
      nome: c.nome, cargo: c.cargo ?? "", tipo: c.tipo,
      telefone: c.telefone ?? "", whatsapp: c.whatsapp ?? "",
      email: c.email ?? "", principal: c.principal,
    });
    setEditando(c.id);
    setExpandido((prev) => { const n = new Set(prev); n.add(c.id); return n; });
    setErro("");
  }

  function cancelar() { setEditando(null); setErro(""); }
  function updateField(field: keyof ContatoFormData, value: any) { setForm((f) => ({ ...f, [field]: value })); }

  async function salvar() {
    if (!form.nome.trim()) { setErro("Nome do contato é obrigatório."); return; }
    setSalvando(true); setErro("");
    try {
      if (editando === "novo") {
        const res = await fetch(`/api/clientes/${clienteId}/contatos`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar contato."); return; }
        const novo = await res.json();
        setContatos((prev) => [...prev, novo]);
      } else {
        const res = await fetch(`/api/clientes/${clienteId}/contatos/${editando}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao atualizar."); return; }
        const atualizado = await res.json();
        setContatos((prev) => prev.map((c) => (c.id === editando ? atualizado : c)));
      }
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!confirm("Remover este contato?")) return;
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro."); return; }
      setContatos((prev) => prev.filter((c) => c.id !== id));
    } catch { setErro("Erro de conexão."); }
  }

  function renderForm() {
    return (
      <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-frivo-800">{editando === "novo" ? "Novo contato" : "Editar contato"}</h4>
          <button type="button" onClick={cancelar} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <FormGrid>
          <FormField label="Nome" required><Input value={form.nome} onChange={(e) => updateField("nome", e.target.value)} placeholder="Nome completo" /></FormField>
          <FormField label="Cargo"><Input value={form.cargo} onChange={(e) => updateField("cargo", e.target.value)} placeholder="Ex: Gerente, Coordenador" /></FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Tipo">
            <Select value={form.tipo} onChange={(e) => updateField("tipo", e.target.value)}>
              {Object.entries(LABELS_TIPO_CONTATO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </Select>
          </FormField>
          <FormField label="E-mail"><Input value={form.email} onChange={(e) => updateField("email", e.target.value)} type="email" placeholder="email@empresa.com" /></FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Telefone"><PhoneInput value={form.telefone} onChange={(e: any) => updateField("telefone", e.target.value)} placeholder="(00) 0000-0000" /></FormField>
          <FormField label="WhatsApp"><WhatsAppInput value={form.whatsapp} onChange={(e: any) => updateField("whatsapp", e.target.value)} placeholder="(00) 00000-0000" /></FormField>
        </FormGrid>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Adicionar" : "Salvar"}</Button>
        </div>
      </div>
    );
  }

  const ordenados = [...contatos].sort((a, b) => {
    if (a.principal && !b.principal) return -1;
    if (!a.principal && b.principal) return 1;
    return a.nome.localeCompare(b.nome);
  });

  return (
    <div className="space-y-2">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {ordenados.length === 0 && !editando && (
        <p className="text-sm text-gray-400 py-2">Nenhum contato cadastrado.</p>
      )}

      {ordenados.map((c) => {
        if (editando === c.id) return <div key={c.id}>{renderForm()}</div>;
        const aberto = expandido.has(c.id);
        return (
          <div key={c.id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button type="button" onClick={() => toggleExpand(c.id)} className="flex items-center justify-between w-full p-3 text-left hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <UserCircle className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{c.nome}</span>
                    <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                      {LABELS_TIPO_CONTATO[c.tipo] ?? c.tipo}
                    </span>
                  </div>
                  {c.cargo && <p className="text-xs text-gray-500">{c.cargo}</p>}
                </div>
              </div>
              {aberto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>
            {aberto && (
              <div className="border-t border-gray-100 p-3 space-y-2 bg-gray-50/50">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {c.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3 text-gray-400" /> <a href={`mailto:${c.email}`} className="text-frivo-600 hover:underline">{c.email}</a></div>}
                  {c.telefone && <div className="flex items-center gap-1"><Phone className="w-3 h-3 text-gray-400" /> <a href={`tel:${c.telefone.replace(/\D/g, "")}`} className="text-gray-700">{c.telefone}</a></div>}
                  {c.whatsapp && <div className="flex items-center gap-1"><span className="text-green-500 text-[10px] font-bold">WA</span> <a href={`https://wa.me/55${c.whatsapp.replace(/\D/g, "")}`} target="_blank" className="text-gray-700">{c.whatsapp}</a></div>}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button type="button" variant="secondary" onClick={() => abrirEditar(c)} className="text-xs h-7 px-2.5"><Pencil className="w-3 h-3" /> Editar</Button>
                  <Button type="button" variant="ghost" onClick={() => remover(c.id)} className="text-xs h-7 px-2.5 text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3" /> Remover</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {editando === "novo" && renderForm()}

      {!editando && (
        <Button type="button" variant="secondary" onClick={abrirNovo} className="w-full justify-center border-dashed mt-2">
          <Plus className="w-4 h-4" /> Adicionar contato
        </Button>
      )}
    </div>
  );
}
