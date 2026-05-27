"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Plus, Pencil, Trash2, X, Check, GripVertical, ChevronDown, ChevronRight } from "lucide-react";

const TIPOS_CAMPO = [
  { value: "TEXTO_CURTO", label: "Texto curto" },
  { value: "TEXTO_LONGO", label: "Texto longo" },
  { value: "NUMERO", label: "Número" },
  { value: "SIM_NAO", label: "Sim / Não" },
  { value: "MULTIPLA_ESCOLHA", label: "Múltipla escolha" },
  { value: "DATA", label: "Data" },
  { value: "FOTO", label: "Foto obrigatória" },
  { value: "ASSINATURA", label: "Assinatura" },
];

interface Campo { id?: string; label: string; tipo: string; obrigatorio: boolean; ordem: number; opcoes?: any }
interface Formulario { id: string; nome: string; descricao?: string; tipoOsId?: string | null; campos: Campo[]; tipoOs?: { id: string; nome: string; cor: string } | null }
interface TipoOs { id: string; nome: string; cor: string; ativo?: boolean }

export default function FormulariosPage() {
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [tiposOs, setTiposOs] = useState<TipoOs[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", tipoOsId: "" });
  const [campos, setCampos] = useState<Campo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/formularios").then((r) => r.json()).then(setFormularios).catch(() => {});
    fetch("/api/tipos-os").then((r) => r.json()).then(setTiposOs).catch(() => {});
  }, []);

  function abrirNovo() {
    setForm({ nome: "", descricao: "", tipoOsId: "" });
    setCampos([{ label: "", tipo: "TEXTO_CURTO", obrigatorio: false, ordem: 1 }]);
    setEditando("novo");
    setErro("");
  }

  function abrirEditar(f: Formulario) {
    setForm({ nome: f.nome, descricao: f.descricao ?? "", tipoOsId: f.tipoOsId ?? "" });
    setCampos(f.campos.length > 0 ? f.campos : [{ label: "", tipo: "TEXTO_CURTO", obrigatorio: false, ordem: 1 }]);
    setEditando(f.id);
    setErro("");
  }

  function addCampo() {
    setCampos((p) => [...p, { label: "", tipo: "TEXTO_CURTO", obrigatorio: false, ordem: p.length + 1 }]);
  }

  function removeCampo(idx: number) {
    setCampos((p) => p.filter((_, i) => i !== idx).map((c, i) => ({ ...c, ordem: i + 1 })));
  }

  function updateCampo(idx: number, field: string, value: any) {
    setCampos((p) => p.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro("Nome é obrigatório."); return; }
    const camposValidos = campos.filter((c) => c.label.trim());
    if (camposValidos.length === 0) { setErro("Adicione pelo menos um campo."); return; }

    setSalvando(true); setErro("");
    const payload = {
      ...form,
      tipoOsId: form.tipoOsId || null,
      campos: camposValidos.map((c, i) => ({ label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio, ordem: i + 1, opcoes: c.opcoes })),
    };

    try {
      if (editando === "novo") {
        const res = await fetch("/api/formularios", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) { setErro("Erro ao criar."); return; }
        const novo = await res.json();
        setFormularios((p) => [...p, novo]);
      } else {
        const res = await fetch(`/api/formularios/${editando}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) { setErro("Erro ao salvar."); return; }
        const atualizado = await res.json();
        setFormularios((p) => p.map((f) => (f.id === editando ? atualizado : f)));
      }
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Formulários" description="Templates de formulário para atividades de OS" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

        {/* Lista */}
        {formularios.map((f) => (
          <div key={f.id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button onClick={() => setExpandido(expandido === f.id ? null : f.id)} className="flex items-center justify-between w-full p-3 text-left hover:bg-gray-50">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{f.nome}</span>
                {f.tipoOs && <span className="text-[10px] text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: f.tipoOs.cor }}>{f.tipoOs.nome}</span>}
                <span className="text-[10px] text-gray-400">{f.campos.length} campo(s)</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); abrirEditar(f); }} className="p-1 text-gray-400 hover:text-frivo-600"><Pencil className="w-3.5 h-3.5" /></button>
                {expandido === f.id ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </div>
            </button>
            {expandido === f.id && (
              <div className="border-t border-gray-100 p-3 bg-gray-50/50 space-y-1">
                {f.descricao && <p className="text-xs text-gray-500 mb-2">{f.descricao}</p>}
                {f.campos.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-700">
                    <span className="text-gray-400 w-4 text-right">{c.ordem}.</span>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-gray-400">({TIPOS_CAMPO.find((t) => t.value === c.tipo)?.label ?? c.tipo})</span>
                    {c.obrigatorio && <span className="text-red-500 text-[10px]">obrigatório</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Formulário de criação/edição */}
        {editando && (
          <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-frivo-800">{editando === "novo" ? "Novo formulário" : "Editar formulário"}</h4>
              <button onClick={() => setEditando(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <FormGrid>
              <FormField label="Nome" required>
                <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex: Checklist Manutenção Preventiva" />
              </FormField>
              <FormField label="Tipo de OS vinculado">
                <Select value={form.tipoOsId} onChange={(e) => setForm((f) => ({ ...f, tipoOsId: e.target.value }))} placeholder="Nenhum (genérico)">
                  {tiposOs.filter((t) => t.ativo !== false).map((t: any) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                </Select>
              </FormField>
            </FormGrid>
            <FormField label="Descrição">
              <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={2} />
            </FormField>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase">Campos do formulário</p>
              {campos.map((c, i) => (
                <div key={i} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-2">
                  <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                  <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                  <Input value={c.label} onChange={(e) => updateCampo(i, "label", e.target.value)} placeholder="Label do campo" className="flex-1 text-sm h-8" />
                  <select value={c.tipo} onChange={(e) => updateCampo(i, "tipo", e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs bg-white w-32">
                    {TIPOS_CAMPO.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                    <input type="checkbox" checked={c.obrigatorio} onChange={(e) => updateCampo(i, "obrigatorio", e.target.checked)} className="accent-frivo-600" />
                    Obrig.
                  </label>
                  <button onClick={() => removeCampo(i)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <Button type="button" variant="ghost" onClick={addCampo} className="text-xs h-7 px-2.5">
                <Plus className="w-3 h-3" /> Adicionar campo
              </Button>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> Salvar</Button>
            </div>
          </div>
        )}

        {!editando && (
          <Button type="button" variant="secondary" onClick={abrirNovo} className="w-full justify-center border-dashed">
            <Plus className="w-4 h-4" /> Novo formulário
          </Button>
        )}
      </div>
    </div>
  );
}
