"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { LABELS_TIPO_COMUNICACAO, TIPOS_COMUNICACAO, COR_TIPO_CONTATO, cn } from "@/lib/utils";
import type { ContatoCliente } from "@prisma/client";
import { Plus, Pencil, Trash2, X, Check, Mail, Phone, Star } from "lucide-react";

interface ComunicacaoFormData {
  nome: string;
  email: string;
  telefone: string;
  tipo: string;
  principal: boolean;
}

const emptyForm: ComunicacaoFormData = { nome: "", email: "", telefone: "", tipo: "OPERACIONAL", principal: false };

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

interface ComunicacaoManagerProps {
  clienteId: string;
  contatosIniciais: ContatoCliente[];
}

export function ComunicacaoManager({ clienteId, contatosIniciais }: ComunicacaoManagerProps) {
  // Apenas contatos dos tipos de comunicação (a aba "Contatos" cuida dos demais).
  const inicial = contatosIniciais.filter((c) => (TIPOS_COMUNICACAO as readonly string[]).includes(c.tipo));
  const [contatos, setContatos] = useState<ContatoCliente[]>(inicial);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState<ComunicacaoFormData>(emptyForm);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  function abrirNovo() {
    setForm({ ...emptyForm });
    setEditando("novo");
    setErro("");
  }

  function abrirEditar(c: ContatoCliente) {
    setForm({ nome: c.nome, email: c.email ?? "", telefone: c.telefone ?? "", tipo: c.tipo, principal: c.principal });
    setEditando(c.id);
    setErro("");
  }

  function cancelar() { setEditando(null); setErro(""); }
  function updateField(field: keyof ComunicacaoFormData, value: any) { setForm((f) => ({ ...f, [field]: value })); }

  // Mantém os campos do contato (cargo/whatsapp/portal) intactos ao atualizar via API.
  function payloadDe(c: ContatoCliente, over: Partial<ComunicacaoFormData>) {
    return {
      nome: over.nome ?? c.nome,
      cargo: c.cargo ?? "",
      tipo: over.tipo ?? c.tipo,
      telefone: over.telefone ?? c.telefone ?? "",
      whatsapp: c.whatsapp ?? "",
      email: over.email ?? c.email ?? "",
      principal: over.principal ?? c.principal,
    };
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro("Nome do contato é obrigatório."); return; }
    if (!emailValido(form.email)) { setErro("Informe um e-mail válido."); return; }
    setSalvando(true); setErro("");
    const body = {
      nome: form.nome.trim(),
      cargo: editando !== "novo" ? (contatos.find((c) => c.id === editando)?.cargo ?? "") : "",
      tipo: form.tipo,
      telefone: form.telefone,
      whatsapp: editando !== "novo" ? (contatos.find((c) => c.id === editando)?.whatsapp ?? "") : "",
      email: form.email.trim(),
      principal: form.principal,
    };
    try {
      let salvo: ContatoCliente;
      if (editando === "novo") {
        const res = await fetch(`/api/clientes/${clienteId}/contatos`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar contato."); return; }
        salvo = await res.json();
        setContatos((prev) => [...prev, salvo]);
      } else {
        const res = await fetch(`/api/clientes/${clienteId}/contatos/${editando}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao atualizar."); return; }
        salvo = await res.json();
        setContatos((prev) => prev.map((c) => (c.id === salvo.id ? salvo : c)));
      }
      if (salvo.principal) await limparOutrosPrincipais(salvo);
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  // Garante apenas um contato principal por tipo.
  async function limparOutrosPrincipais(principalAtual: ContatoCliente) {
    const outros = contatos.filter((c) => c.id !== principalAtual.id && c.tipo === principalAtual.tipo && c.principal);
    if (outros.length === 0) return;
    await Promise.all(outros.map((c) =>
      fetch(`/api/clientes/${clienteId}/contatos/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadDe(c, { principal: false })),
      }).catch(() => {}),
    ));
    setContatos((prev) => prev.map((c) => (outros.some((o) => o.id === c.id) ? { ...c, principal: false } : c)));
  }

  async function alternarPrincipal(c: ContatoCliente) {
    const novoValor = !c.principal;
    setContatos((prev) => prev.map((x) => (x.id === c.id ? { ...x, principal: novoValor } : x)));
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadDe(c, { principal: novoValor })),
      });
      if (!res.ok) { setContatos((prev) => prev.map((x) => (x.id === c.id ? { ...x, principal: c.principal } : x))); return; }
      if (novoValor) await limparOutrosPrincipais({ ...c, principal: true });
    } catch {
      setContatos((prev) => prev.map((x) => (x.id === c.id ? { ...x, principal: c.principal } : x)));
    }
  }

  async function remover(id: string) {
    if (!confirm("Remover este contato?")) return;
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao remover."); return; }
      setContatos((prev) => prev.filter((c) => c.id !== id));
    } catch { setErro("Erro de conexão."); }
  }

  function renderForm() {
    return (
      <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-primary-800">{editando === "novo" ? "Novo contato" : "Editar contato"}</h4>
          <button type="button" onClick={cancelar} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <FormGrid>
          <FormField label="Nome" required><Input value={form.nome} onChange={(e) => updateField("nome", e.target.value)} placeholder="Nome completo" /></FormField>
          <FormField label="E-mail" required><Input value={form.email} onChange={(e) => updateField("email", e.target.value)} type="email" placeholder="email@empresa.com" /></FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Telefone"><PhoneInput value={form.telefone} onChange={(e: any) => updateField("telefone", e.target.value)} placeholder="(00) 0000-0000" /></FormField>
          <FormField label="Tipo">
            <Select value={form.tipo} onChange={(e) => updateField("tipo", e.target.value)}>
              {TIPOS_COMUNICACAO.map((v) => (<option key={v} value={v}>{LABELS_TIPO_COMUNICACAO[v]}</option>))}
            </Select>
          </FormField>
        </FormGrid>
        <div className="border-t border-gray-100 pt-1">
          <ToggleSwitch
            label="Contato principal deste tipo"
            description="Recebe os e-mails da área como destinatário principal."
            checked={form.principal}
            onChange={(v) => updateField("principal", v)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Adicionar" : "Salvar"}</Button>
        </div>
      </div>
    );
  }

  const ordenados = [...contatos].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
    if (a.principal && !b.principal) return -1;
    if (!a.principal && b.principal) return 1;
    return a.nome.localeCompare(b.nome);
  });

  return (
    <div className="space-y-2">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {ordenados.length === 0 && !editando && (
        <p className="text-sm text-gray-400 py-2">Nenhum contato de comunicação cadastrado. Os e-mails usarão o e-mail principal do cliente.</p>
      )}

      {ordenados.map((c) =>
        editando === c.id ? (
          <div key={c.id}>{renderForm()}</div>
        ) : (
          <div key={c.id} className="border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900">{c.nome}</span>
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", COR_TIPO_CONTATO[c.tipo] ?? "bg-gray-100 text-gray-600")}>
                  {LABELS_TIPO_COMUNICACAO[c.tipo as keyof typeof LABELS_TIPO_COMUNICACAO] ?? c.tipo}
                </span>
              </div>
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs">
                {c.email && <span className="flex items-center gap-1 text-gray-600"><Mail className="w-3 h-3 text-gray-400" /> {c.email}</span>}
                {c.telefone && <span className="flex items-center gap-1 text-gray-600"><Phone className="w-3 h-3 text-gray-400" /> {c.telefone}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => alternarPrincipal(c)}
                title={c.principal ? "Contato principal deste tipo" : "Definir como principal"}
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors",
                  c.principal
                    ? "bg-amber-50 border-amber-200 text-amber-700"
                    : "border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300",
                )}
              >
                <Star className={cn("w-3 h-3", c.principal && "fill-amber-400 text-amber-400")} /> Principal
              </button>
              <Button type="button" variant="secondary" onClick={() => abrirEditar(c)} className="text-xs h-7 px-2.5"><Pencil className="w-3 h-3" /> Editar</Button>
              <Button type="button" variant="ghost" onClick={() => remover(c.id)} className="text-xs h-7 px-2.5 text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3" /></Button>
            </div>
          </div>
        ),
      )}

      {editando === "novo" && renderForm()}

      {!editando && (
        <Button type="button" variant="secondary" onClick={abrirNovo} className="w-full justify-center border-dashed mt-2">
          <Plus className="w-4 h-4" /> Adicionar contato
        </Button>
      )}
    </div>
  );
}
