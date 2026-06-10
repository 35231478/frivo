"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { cn, formatarDataHora } from "@/lib/utils";
import { Plus, X, Check, ChevronDown, ChevronRight, Wrench, User } from "lucide-react";

const STATUS_LABELS: Record<string, string> = { AGENDADA: "Agendada", EM_ANDAMENTO: "Em Andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };
const STATUS_COR: Record<string, string> = { AGENDADA: "bg-purple-100 text-purple-700", EM_ANDAMENTO: "bg-yellow-100 text-yellow-700", CONCLUIDA: "bg-green-100 text-green-700", CANCELADA: "bg-red-100 text-red-700" };

export function OsAtividades({ osId, atividades: iniciais }: { osId: string; atividades: any[] }) {
  const [atividades, setAtividades] = useState(iniciais);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [mostraForm, setMostraForm] = useState(false);
  const [tiposOs, setTiposOs] = useState<any[]>([]);
  const [tecnicos, setTecnicos] = useState<any[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ titulo: "", tipoOsId: "", tecnicoId: "", dataAgendada: "", duracaoMin: "", observacao: "" });

  useEffect(() => {
    fetch("/api/tipos-os").then((r) => r.json()).then(setTiposOs).catch(() => {});
    fetch("/api/tecnicos").then((r) => r.json()).then(setTecnicos).catch(() => {});
  }, []);

  function toggleExpand(id: string) {
    setExpandido((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function criarAtividade() {
    if (!form.titulo.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/ordens/${osId}/atividades`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, duracaoMin: form.duracaoMin ? Number(form.duracaoMin) : undefined }),
      });
      if (res.ok) {
        const nova = await res.json();
        setAtividades((p) => [...p, nova]);
        setForm({ titulo: "", tipoOsId: "", tecnicoId: "", dataAgendada: "", duracaoMin: "", observacao: "" });
        setMostraForm(false);
      }
    } catch {} finally { setSalvando(false); }
  }

  async function alterarStatusAtividade(atividadeId: string, novoStatus: string) {
    const res = await fetch(`/api/ordens/${osId}/atividades/${atividadeId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: novoStatus }),
    });
    if (res.ok) {
      const atualizada = await res.json();
      setAtividades((p) => p.map((a) => (a.id === atividadeId ? atualizada : a)));
    }
  }

  return (
    <div className="space-y-3">
      {atividades.length === 0 && !mostraForm && (
        <p className="text-sm text-gray-400 text-center py-6">Nenhuma atividade cadastrada.</p>
      )}

      {atividades.map((a) => {
        const aberto = expandido.has(a.id);
        return (
          <div key={a.id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button type="button" onClick={() => toggleExpand(a.id)} className="flex items-center justify-between w-full p-3 text-left hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <Wrench className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{a.titulo}</span>
                    {a.tipoOs && <span className="text-[10px] font-medium text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: a.tipoOs.cor }}>{a.tipoOs.nome}</span>}
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", STATUS_COR[a.status])}>{STATUS_LABELS[a.status]}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                    {a.tecnico && <span className="flex items-center gap-1"><User className="w-3 h-3" />{a.tecnico.nome}</span>}
                    {a.dataAgendada && <span>{formatarDataHora(a.dataAgendada)}</span>}
                    {a.duracaoMin && <span>{a.duracaoMin} min</span>}
                  </div>
                </div>
              </div>
              {aberto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>

            {aberto && (
              <div className="border-t border-gray-100 p-3 space-y-3 bg-gray-50/50">
                {a.observacao && <p className="text-sm text-gray-600">{a.observacao}</p>}
                {a.resumo && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Resumo do formulário:</p>
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded-lg p-3 border border-gray-100 font-sans">{a.resumo}</pre>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Select value={a.status} onChange={(e) => alterarStatusAtividade(a.id, e.target.value)} className="text-xs w-auto h-7">
                    {Object.entries(STATUS_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                  </Select>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {mostraForm && (
        <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-frivo-800">Nova atividade</h4>
            <button type="button" onClick={() => setMostraForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <FormField label="Título" required>
            <Input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Descrição breve da atividade" />
          </FormField>
          <FormGrid>
            <FormField label="Tipo de OS">
              <Select value={form.tipoOsId} onChange={(e) => setForm((f) => ({ ...f, tipoOsId: e.target.value }))} placeholder="Selecione">
                {tiposOs.filter((t) => t.ativo).map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
              </Select>
            </FormField>
            <FormField label="Técnico" hint={form.tipoOsId ? "Apenas colaboradores com competência neste tipo de OS" : undefined}>
              <Select value={form.tecnicoId} onChange={(e) => setForm((f) => ({ ...f, tecnicoId: e.target.value }))} placeholder="Selecione">
                {tecnicos
                  .filter((t: any) => !form.tipoOsId || (t.competencias ?? []).some((c: any) => c.id === form.tipoOsId))
                  .map((t: any) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
              </Select>
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Data/hora agendada">
              <Input type="datetime-local" value={form.dataAgendada} onChange={(e) => setForm((f) => ({ ...f, dataAgendada: e.target.value }))} />
            </FormField>
            <FormField label="Duração estimada (min)">
              <Input type="number" value={form.duracaoMin} onChange={(e) => setForm((f) => ({ ...f, duracaoMin: e.target.value }))} placeholder="120" />
            </FormField>
          </FormGrid>
          <FormField label="Observação">
            <Textarea value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} rows={2} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMostraForm(false)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={criarAtividade}><Check className="w-4 h-4" /> Adicionar</Button>
          </div>
        </div>
      )}

      {!mostraForm && atividades.length < 20 && (
        <Button type="button" variant="secondary" onClick={() => setMostraForm(true)} className="w-full justify-center border-dashed">
          <Plus className="w-4 h-4" /> Nova atividade
        </Button>
      )}
    </div>
  );
}
