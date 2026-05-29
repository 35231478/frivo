"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { cn, LABELS_RESPONSAVEL_PRAZO, LABELS_CANAL_NOTIFICACAO, formatarPrazoHoras } from "@/lib/utils";
import { Plus, Pencil, Trash2, X, Check, ArrowUp, ArrowDown, Clock } from "lucide-react";

type UnidadePrazo = "minutos" | "horas" | "dias";

interface Etapa {
  _id: string;
  nome: string;
  valor: number;
  unidade: UnidadePrazo;
  responsavel: string;
  canal: string;
  mensagem: string;
}

interface Template {
  id: string;
  nome: string;
  descricao?: string | null;
  cor: string;
  ativo: boolean;
  etapas: { id: string; nome: string; prazoHoras: number; responsavel: string; canal: string; mensagem?: string | null; ordem: number }[];
  _count?: { osPrazos: number };
}

const VARIAVEIS = ["{{os_numero}}", "{{cliente_nome}}", "{{produto_nome}}", "{{prazo_etapa}}", "{{link}}"];

function uid() {
  return Math.random().toString(36).slice(2);
}

function horasParaUnidade(h: number): { valor: number; unidade: UnidadePrazo } {
  if (h < 1) return { valor: Math.round(h * 60), unidade: "minutos" };
  if (h >= 24 && h % 24 === 0) return { valor: h / 24, unidade: "dias" };
  return { valor: h, unidade: "horas" };
}

function unidadeParaHoras(valor: number, unidade: UnidadePrazo): number {
  if (unidade === "minutos") return valor / 60;
  if (unidade === "dias") return valor * 24;
  return valor;
}

export function PrazoTemplatesClient() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState("#0EA5E9");
  const [etapas, setEtapas] = useState<Etapa[]>([]);

  useEffect(() => {
    fetch("/api/prazo-templates").then((r) => r.json()).then(setTemplates).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function abrirNovo() {
    setNome(""); setDescricao(""); setCor("#0EA5E9"); setEtapas([]); setErro("");
    setEditando("novo");
  }

  function abrirEditar(t: Template) {
    setNome(t.nome); setDescricao(t.descricao ?? ""); setCor(t.cor); setErro("");
    setEtapas(t.etapas.map((e) => {
      const u = horasParaUnidade(e.prazoHoras);
      return { _id: uid(), nome: e.nome, valor: u.valor, unidade: u.unidade, responsavel: e.responsavel, canal: e.canal, mensagem: e.mensagem ?? "" };
    }));
    setEditando(t.id);
  }

  function addEtapa() {
    setEtapas((p) => [...p, { _id: uid(), nome: "", valor: 24, unidade: "horas", responsavel: "COMPRADOR", canal: "WHATSAPP", mensagem: "" }]);
  }
  function patchEtapa(id: string, patch: Partial<Etapa>) {
    setEtapas((p) => p.map((e) => (e._id === id ? { ...e, ...patch } : e)));
  }
  function removerEtapa(id: string) {
    setEtapas((p) => p.filter((e) => e._id !== id));
  }
  function mover(id: string, dir: -1 | 1) {
    setEtapas((p) => {
      const idx = p.findIndex((e) => e._id === id);
      const novo = idx + dir;
      if (novo < 0 || novo >= p.length) return p;
      const arr = [...p];
      [arr[idx], arr[novo]] = [arr[novo], arr[idx]];
      return arr;
    });
  }

  async function salvar() {
    if (!nome.trim()) return setErro("Informe o nome do template.");
    if (etapas.length === 0) return setErro("Adicione ao menos uma etapa.");
    if (etapas.some((e) => !e.nome.trim())) return setErro("Toda etapa precisa de um nome.");

    const payload = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      cor,
      ativo: true,
      etapas: etapas.map((e, idx) => ({
        nome: e.nome.trim(),
        prazoHoras: unidadeParaHoras(e.valor, e.unidade),
        responsavel: e.responsavel,
        canal: e.canal,
        mensagem: e.mensagem.trim() || null,
        ordem: idx,
      })),
    };

    setSalvando(true); setErro("");
    try {
      const url = editando === "novo" ? "/api/prazo-templates" : `/api/prazo-templates/${editando}`;
      const method = editando === "novo" ? "POST" : "PUT";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Erro ao salvar."); return; }
      const saved = await res.json();
      setTemplates((p) => (editando === "novo" ? [...p, saved] : p.map((t) => (t.id === editando ? saved : t))));
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!confirm("Desativar este template?")) return;
    await fetch(`/api/prazo-templates/${id}`, { method: "DELETE" });
    setTemplates((p) => p.map((t) => (t.id === id ? { ...t, ativo: false } : t)));
  }

  const ativos = templates.filter((t) => t.ativo !== false);

  return (
    <div className="space-y-4">
      {erro && !editando && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {loading ? (
        <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>
      ) : editando ? (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-700">{editando === "novo" ? "Novo template" : "Editar template"}</h4>
            <button onClick={() => setEditando(null)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

          <FormGrid cols={2}>
            <FormField label="Nome do prazo" required>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Compra de Material" />
            </FormField>
            <FormField label="Cor de identificação">
              <div className="flex items-center gap-2">
                <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="w-10 h-10 rounded border border-surface-border cursor-pointer" />
                <Input value={cor} onChange={(e) => setCor(e.target.value)} className="flex-1 font-mono text-xs" />
              </div>
            </FormField>
          </FormGrid>
          <FormField label="Descrição">
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
          </FormField>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-xs font-bold text-ink-muted uppercase tracking-wider">Etapas do prazo</h5>
            </div>
            <div className="bg-white border border-surface-border rounded-lg p-2 mb-2 text-[11px] text-ink-muted">
              Variáveis disponíveis na mensagem:{" "}
              {VARIAVEIS.map((v) => <code key={v} className="bg-surface-alt rounded px-1 mx-0.5">{v}</code>)}
            </div>

            <div className="space-y-3">
              {etapas.map((e, idx) => (
                <div key={e._id} className="border border-surface-border rounded-lg p-3 bg-white space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                    <Input value={e.nome} onChange={(ev) => patchEtapa(e._id, { nome: ev.target.value })} placeholder="Nome da etapa" className="flex-1" />
                    <button type="button" onClick={() => mover(e._id, -1)} disabled={idx === 0} className="p-1.5 text-ink-muted hover:text-primary-600 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => mover(e._id, 1)} disabled={idx === etapas.length - 1} className="p-1.5 text-ink-muted hover:text-primary-600 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => removerEtapa(e._id)} className="p-1.5 text-ink-muted hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <FormGrid cols={3}>
                    <FormField label="Prazo">
                      <div className="flex gap-1">
                        <Input type="number" min="0" step="0.5" value={e.valor} onChange={(ev) => patchEtapa(e._id, { valor: Number(ev.target.value) || 0 })} className="flex-1" />
                        <Select value={e.unidade} onChange={(ev) => patchEtapa(e._id, { unidade: ev.target.value as UnidadePrazo })} className="w-28">
                          <option value="minutos">minutos</option>
                          <option value="horas">horas</option>
                          <option value="dias">dias</option>
                        </Select>
                      </div>
                    </FormField>
                    <FormField label="Responsável">
                      <Select value={e.responsavel} onChange={(ev) => patchEtapa(e._id, { responsavel: ev.target.value })}>
                        {Object.entries(LABELS_RESPONSAVEL_PRAZO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </Select>
                    </FormField>
                    <FormField label="Canal">
                      <Select value={e.canal} onChange={(ev) => patchEtapa(e._id, { canal: ev.target.value })}>
                        {Object.entries(LABELS_CANAL_NOTIFICACAO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </Select>
                    </FormField>
                  </FormGrid>
                  <FormField label="Mensagem de notificação">
                    <Textarea value={e.mensagem} onChange={(ev) => patchEtapa(e._id, { mensagem: ev.target.value })} rows={2} placeholder="Ex.: OS {{os_numero}} — etapa {{prazo_etapa}}. {{link}}" />
                  </FormField>
                </div>
              ))}
            </div>

            <Button type="button" variant="secondary" onClick={addEtapa} className="w-full justify-center border-dashed mt-2">
              <Plus className="w-4 h-4" /> Adicionar etapa
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Criar template" : "Salvar"}</Button>
          </div>
        </div>
      ) : (
        <>
          {ativos.length === 0 ? (
            <p className="text-sm text-ink-subtle text-center py-8">Nenhum template de prazo cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {ativos.map((t) => (
                <div key={t.id} className="border border-surface-border rounded-lg p-3 flex items-center justify-between hover:bg-surface-alt/40 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{t.nome}</p>
                      <p className="text-xs text-ink-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t.etapas.length} etapa(s): {t.etapas.map((e) => `${e.nome} (${formatarPrazoHoras(e.prazoHoras)})`).join(" → ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => abrirEditar(t)} className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remover(t.id)} className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button type="button" variant="secondary" onClick={abrirNovo} className="w-full justify-center border-dashed">
            <Plus className="w-4 h-4" /> Adicionar template de prazo
          </Button>
        </>
      )}
    </div>
  );
}
