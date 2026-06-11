"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Plus, Pencil, Trash2, X, Check, ArrowRight } from "lucide-react";

interface Opcao { id: string; nome: string; cor?: string; ativo?: boolean }
interface Mapping {
  id: string;
  tipoEquipamentoId: string;
  tipoOsId: string;
  formularioTemplateId: string;
  tipoEquipamento: { id: string; nome: string };
  tipoOs: { id: string; nome: string; cor: string };
  formularioTemplate: { id: string; nome: string };
}

const VAZIO = { tipoEquipamentoId: "", tipoOsId: "", formularioTemplateId: "" };

export default function FormulariosPorTipoPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [tiposEquip, setTiposEquip] = useState<Opcao[]>([]);
  const [tiposOs, setTiposOs] = useState<Opcao[]>([]);
  const [formularios, setFormularios] = useState<Opcao[]>([]);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/configuracoes/formularios-por-tipo").then((r) => r.json()).then(setMappings).catch(() => {});
    fetch("/api/tipos-equipamento").then((r) => r.json()).then(setTiposEquip).catch(() => {});
    fetch("/api/tipos-os").then((r) => r.json()).then(setTiposOs).catch(() => {});
    fetch("/api/formularios").then((r) => r.json()).then(setFormularios).catch(() => {});
  }, []);

  function abrirNovo() {
    setForm(VAZIO);
    setEditando("novo");
    setErro("");
  }

  function abrirEditar(m: Mapping) {
    setForm({ tipoEquipamentoId: m.tipoEquipamentoId, tipoOsId: m.tipoOsId, formularioTemplateId: m.formularioTemplateId });
    setEditando(m.id);
    setErro("");
  }

  async function salvar() {
    if (!form.tipoEquipamentoId || !form.tipoOsId || !form.formularioTemplateId) {
      setErro("Selecione tipo de equipamento, tipo de OS e formulário.");
      return;
    }
    setSalvando(true); setErro("");
    try {
      const url = editando === "novo"
        ? "/api/configuracoes/formularios-por-tipo"
        : `/api/configuracoes/formularios-por-tipo/${editando}`;
      const res = await fetch(url, {
        method: editando === "novo" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data?.erro ?? "Erro ao salvar."); return; }
      setMappings((p) => editando === "novo" ? [...p, data] : p.map((m) => (m.id === editando ? data : m)));
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function excluir(m: Mapping) {
    if (!confirm(`Excluir a vinculação "${m.tipoEquipamento.nome} + ${m.tipoOs.nome}"?`)) return;
    const res = await fetch(`/api/configuracoes/formularios-por-tipo/${m.id}`, { method: "DELETE" });
    if (res.ok) setMappings((p) => p.filter((x) => x.id !== m.id));
  }

  const ativos = (l: Opcao[]) => l.filter((o) => o.ativo !== false);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Formulários por Tipo"
        description="Vincule um formulário a cada combinação de tipo de equipamento + tipo de OS"
        backHref="/configuracoes"
      />
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

        {/* Tabela de vinculações */}
        {mappings.length > 0 ? (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Tipo de Equipamento</th>
                  <th className="text-left font-medium px-3 py-2">Tipo de OS</th>
                  <th className="text-left font-medium px-3 py-2">Formulário</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappings.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{m.tipoEquipamento.nome}</td>
                    <td className="px-3 py-2">
                      <span className="text-[11px] text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: m.tipoOs.cor }}>
                        {m.tipoOs.nome}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{m.formularioTemplate.nome}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => abrirEditar(m)} className="p-1 text-gray-400 hover:text-frivo-600"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => excluir(m)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">Nenhuma vinculação cadastrada ainda.</p>
        )}

        {/* Formulário de criação/edição */}
        {editando && (
          <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-frivo-800">{editando === "novo" ? "Nova vinculação" : "Editar vinculação"}</h4>
              <button onClick={() => setEditando(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <FormGrid>
              <FormField label="Tipo de Equipamento" required>
                <Select value={form.tipoEquipamentoId} onChange={(e) => setForm((f) => ({ ...f, tipoEquipamentoId: e.target.value }))} placeholder="Selecione">
                  {ativos(tiposEquip).map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                </Select>
              </FormField>
              <FormField label="Tipo de OS" required>
                <Select value={form.tipoOsId} onChange={(e) => setForm((f) => ({ ...f, tipoOsId: e.target.value }))} placeholder="Selecione">
                  {ativos(tiposOs).map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                </Select>
              </FormField>
            </FormGrid>
            <FormField label="Formulário" required>
              <Select value={form.formularioTemplateId} onChange={(e) => setForm((f) => ({ ...f, formularioTemplateId: e.target.value }))} placeholder="Selecione">
                {ativos(formularios).map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
              </Select>
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> Salvar</Button>
            </div>
          </div>
        )}

        {!editando && (
          <Button type="button" variant="secondary" onClick={abrirNovo} className="w-full justify-center border-dashed">
            <Plus className="w-4 h-4" /> Nova vinculação
          </Button>
        )}

        <p className="text-[11px] text-gray-400 flex items-center gap-1 pt-1">
          <ArrowRight className="w-3 h-3" /> Cada combinação de tipo de equipamento + tipo de OS aponta para um único formulário.
        </p>
      </div>
    </div>
  );
}
