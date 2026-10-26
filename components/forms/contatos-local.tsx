"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { WhatsAppInput } from "@/components/ui/whatsapp-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Plus, Pencil, Trash2, X, Check, UserCircle, ChevronDown, ChevronRight, Star, Phone, Mail } from "lucide-react";
import { comparaNatural } from "@/lib/utils";

export interface ContatoLocal {
  _tempId: string;
  nome: string;
  cargo: string;
  tipo: string;
  telefone: string;
  whatsapp: string;
  email: string;
  principal: boolean;
}

const emptyContato = (): ContatoLocal => ({
  _tempId: crypto.randomUUID(),
  nome: "", cargo: "", tipo: "OUTRO", telefone: "", whatsapp: "", email: "", principal: false,
});

interface ContatosLocalProps {
  contatos: ContatoLocal[];
  onChange: (contatos: ContatoLocal[]) => void;
}

export function ContatosLocal({ contatos, onChange }: ContatosLocalProps) {
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<ContatoLocal>(emptyContato());

  function toggleExpand(id: string) {
    setExpandido((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function abrirNovo() {
    const f = emptyContato();
    f.principal = contatos.length === 0;
    setForm(f);
    setEditando("novo");
  }

  function abrirEditar(c: ContatoLocal) {
    setForm({ ...c });
    setEditando(c._tempId);
    setExpandido((prev) => { const n = new Set(prev); n.add(c._tempId); return n; });
  }

  function cancelar() { setEditando(null); }

  function updateField(field: keyof ContatoLocal, value: any) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function salvar() {
    if (!form.nome.trim()) return;
    if (editando === "novo") {
      onChange([...contatos, form]);
      setExpandido((prev) => { const n = new Set(prev); n.add(form._tempId); return n; });
    } else {
      onChange(contatos.map((c) => (c._tempId === editando ? form : c)));
    }
    setEditando(null);
  }

  function remover(id: string) {
    onChange(contatos.filter((c) => c._tempId !== id));
  }

  const ordenados = [...contatos].sort((a, b) => {
    if (a.principal && !b.principal) return -1;
    if (!a.principal && b.principal) return 1;
    return comparaNatural(a.nome, b.nome);
  });

  function renderForm() {
    return (
      <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-frivo-800">{editando === "novo" ? "Novo contato" : "Editar contato"}</h4>
          <button type="button" onClick={cancelar} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        <FormGrid>
          <FormField label="Nome" required>
            <Input value={form.nome} onChange={(e) => updateField("nome", e.target.value)} placeholder="Nome completo" />
          </FormField>
          <FormField label="Cargo">
            <Input value={form.cargo} onChange={(e) => updateField("cargo", e.target.value)} placeholder="Ex: Gerente, Coordenador" />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="E-mail">
            <Input value={form.email} onChange={(e) => updateField("email", e.target.value)} type="email" placeholder="email@empresa.com" />
          </FormField>
          <FormField label="Telefone">
            <PhoneInput value={form.telefone} onChange={(e: any) => updateField("telefone", e.target.value)} placeholder="(00) 0000-0000" />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="WhatsApp">
            <WhatsAppInput value={form.whatsapp} onChange={(e: any) => updateField("whatsapp", e.target.value)} placeholder="(00) 00000-0000" />
          </FormField>
        </FormGrid>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={!form.nome.trim()}>
            <Check className="w-4 h-4" /> {editando === "novo" ? "Adicionar" : "Salvar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ordenados.length === 0 && !editando && (
        <p className="text-sm text-ink-muted py-2">Nenhum contato adicionado.</p>
      )}

      {ordenados.map((c) => {
        if (editando === c._tempId) return <div key={c._tempId}>{renderForm()}</div>;
        const aberto = expandido.has(c._tempId);
        return (
          <div key={c._tempId} className="border border-surface-border rounded-lg overflow-hidden">
            <button type="button" onClick={() => toggleExpand(c._tempId)} className="flex items-center justify-between w-full p-3 text-left hover:bg-surface-page transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <UserCircle className="w-4 h-4 text-ink-muted shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink">{c.nome}</span>
                    {c.principal && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-1.5 py-0.5 rounded-full">
                        <Star className="w-2.5 h-2.5 fill-current" /> Principal
                      </span>
                    )}
                  </div>
                  {c.cargo && <p className="text-xs text-ink-muted">{c.cargo}</p>}
                </div>
              </div>
              {aberto ? <ChevronDown className="w-4 h-4 text-ink-muted" /> : <ChevronRight className="w-4 h-4 text-ink-muted" />}
            </button>
            {aberto && (
              <div className="border-t border-surface-linha p-3 space-y-2 bg-surface-page/50">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {c.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3 text-ink-muted" /> <span className="text-ink">{c.email}</span></div>}
                  {c.telefone && <div className="flex items-center gap-1"><Phone className="w-3 h-3 text-ink-muted" /> <span className="text-ink">{c.telefone}</span></div>}
                  {c.whatsapp && <div className="flex items-center gap-1"><span className="text-ok-texto text-[10px] font-bold">WA</span> <span className="text-ink">{c.whatsapp}</span></div>}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button type="button" variant="secondary" onClick={() => abrirEditar(c)} className="text-xs h-7 px-2.5"><Pencil className="w-3 h-3" /> Editar</Button>
                  <Button type="button" variant="ghost" onClick={() => remover(c._tempId)} className="text-xs h-7 px-2.5 text-atrasado hover:text-atrasado-texto"><Trash2 className="w-3 h-3" /> Remover</Button>
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
