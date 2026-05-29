"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn, formatarDataHora, formatarPrazoHoras, LABELS_RESPONSAVEL_PRAZO, LABELS_STATUS_OS_PRAZO } from "@/lib/utils";
import { Plus, CheckCircle2, AlertTriangle, Circle, ChevronRight, Trash2, Timer } from "lucide-react";

interface Etapa {
  id: string; nome: string; prazoHoras: number; prazoLimite: string;
  status: string; responsavel: string; concluidaEm?: string | null; concluidaPor?: string | null; ordem: number;
}
interface Prazo {
  id: string; nome: string; status: string; etapaAtual: number;
  etapas: Etapa[]; template?: { cor?: string } | null;
}
interface Template { id: string; nome: string; ativo: boolean }

export function OsPrazos({ osId }: { osId: string }) {
  const [prazos, setPrazos] = useState<Prazo[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [adicionando, setAdicionando] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [acao, setAcao] = useState<string | null>(null);

  function carregar() {
    fetch(`/api/ordens/${osId}/prazos`).then((r) => r.json()).then((d) => setPrazos(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    fetch("/api/prazo-templates").then((r) => r.json()).then((d) => setTemplates(Array.isArray(d) ? d.filter((t: Template) => t.ativo !== false) : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function adicionar() {
    if (!templateId) return;
    setAcao("add");
    try {
      const res = await fetch(`/api/ordens/${osId}/prazos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId }) });
      if (res.ok) { setAdicionando(false); setTemplateId(""); carregar(); }
    } finally { setAcao(null); }
  }

  async function avancar(prazoId: string) {
    setAcao(prazoId);
    try {
      const res = await fetch(`/api/os-prazos/${prazoId}/avancar`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener");
        carregar();
      }
    } finally { setAcao(null); }
  }

  async function cancelar(prazoId: string) {
    if (!confirm("Cancelar este prazo?")) return;
    await fetch(`/api/os-prazos/${prazoId}`, { method: "DELETE" });
    carregar();
  }

  if (loading) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title flex items-center gap-2"><Timer className="w-4 h-4 text-primary-600" /> Prazos / SLA</h3>
        {!adicionando && (
          <Button variant="outline" size="sm" onClick={() => setAdicionando(true)}>
            <Plus className="w-4 h-4" /> Adicionar prazo
          </Button>
        )}
      </div>

      {adicionando && (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs font-semibold text-ink">Template de prazo</label>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Selecione um template" className="mt-1">
              {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          </div>
          <Button onClick={adicionar} loading={acao === "add"} disabled={!templateId}>Criar</Button>
          <Button variant="secondary" onClick={() => setAdicionando(false)}>Cancelar</Button>
        </div>
      )}

      {prazos.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-6">Nenhum prazo adicionado a esta OS.</p>
      ) : (
        <div className="space-y-4">
          {prazos.map((p) => {
            const ativo = p.status === "ATIVO" || p.status === "ATRASADO";
            return (
              <div key={p.id} className="border border-surface-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.template?.cor ?? "#0EA5E9" }} />
                    <span className="font-semibold text-ink">{p.nome}</span>
                    <span className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full",
                      p.status === "CONCLUIDO" ? "bg-success-50 text-success-700" :
                      p.status === "ATRASADO" ? "bg-red-50 text-red-700" :
                      p.status === "CANCELADO" ? "bg-slate-100 text-slate-500" : "bg-primary-50 text-primary-700",
                    )}>{LABELS_STATUS_OS_PRAZO[p.status]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {ativo && (
                      <Button size="sm" variant="primary" onClick={() => avancar(p.id)} loading={acao === p.id}>
                        Avançar etapa <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {p.status !== "CANCELADO" && p.status !== "CONCLUIDO" && (
                      <button onClick={() => cancelar(p.id)} className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded" title="Cancelar prazo"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>

                {/* Linha do tempo */}
                <ol className="relative border-l-2 border-surface-border ml-2 space-y-4">
                  {p.etapas.map((e) => {
                    const concluida = e.status === "CONCLUIDA";
                    const atrasada = e.status === "ATRASADA";
                    const emAndamento = e.status === "EM_ANDAMENTO";
                    return (
                      <li key={e.id} className="ml-5">
                        <span className={cn(
                          "absolute -left-[11px] flex items-center justify-center w-5 h-5 rounded-full ring-4 ring-white",
                          concluida ? "bg-success-500" : atrasada ? "bg-red-500" : emAndamento ? "bg-primary-500 animate-pulse" : "bg-slate-300",
                        )}>
                          {concluida ? <CheckCircle2 className="w-3 h-3 text-white" /> : atrasada ? <AlertTriangle className="w-3 h-3 text-white" /> : <Circle className="w-2 h-2 text-white fill-white" />}
                        </span>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className={cn("text-sm font-medium", concluida ? "text-ink-muted line-through" : atrasada ? "text-red-700" : "text-ink")}>
                              {e.nome}
                            </p>
                            <p className="text-xs text-ink-muted">
                              {LABELS_RESPONSAVEL_PRAZO[e.responsavel]} · prazo {formatarPrazoHoras(e.prazoHoras)} · limite {formatarDataHora(e.prazoLimite)}
                            </p>
                            {concluida && e.concluidaEm && (
                              <p className="text-[11px] text-success-700">✅ Concluída em {formatarDataHora(e.concluidaEm)}{e.concluidaPor ? ` por ${e.concluidaPor}` : ""}</p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
