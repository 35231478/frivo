"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import {
  SECOES, ACOES_LABEL, PRESETS, TIPOS_PERFIL_LABEL, permissoesVazias,
  type Permissoes, type Acao,
} from "@/lib/permissoes";
import { Plus, Pencil, Copy, Trash2, X, Check, ShieldCheck, AlertCircle, Eye } from "lucide-react";

const TIPOS = ["ADMINISTRADOR", "SUPERVISOR", "FINANCEIRO", "TECNICO", "AUXILIAR", "PERSONALIZADO"];

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors", checked ? "bg-success-500" : "bg-surface-border")}
    >
      <span className={cn("inline-block h-[18px] w-[18px] rounded-full bg-white shadow transform transition-transform mt-[2px]", checked ? "translate-x-[20px]" : "translate-x-[2px]")} />
    </button>
  );
}

export function PerfisClient() {
  const [perfis, setPerfis] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("PERSONALIZADO");
  const [cor, setCor] = useState("#8B5CF6");
  const [descricao, setDescricao] = useState("");
  const [permissoes, setPermissoes] = useState<Permissoes>(permissoesVazias());

  useEffect(() => {
    fetch("/api/perfis-acesso").then((r) => r.json()).then((d) => setPerfis(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function abrirNovo() {
    setNome(""); setTipo("PERSONALIZADO"); setCor("#8B5CF6"); setDescricao("");
    setPermissoes(permissoesVazias()); setEditando("novo"); setErro("");
  }
  function abrirEditar(p: any) {
    setNome(p.nome); setTipo(p.tipo); setCor(p.cor); setDescricao(p.descricao ?? "");
    setPermissoes({ ...permissoesVazias(), ...(p.permissoes ?? {}) }); setEditando(p.id); setErro("");
  }
  function duplicar(p: any) {
    setNome(`${p.nome} (cópia)`); setTipo("PERSONALIZADO"); setCor(p.cor); setDescricao(p.descricao ?? "");
    setPermissoes({ ...permissoesVazias(), ...(p.permissoes ?? {}) }); setEditando("novo"); setErro("");
  }

  function aplicarPreset(novoTipo: string) {
    setTipo(novoTipo);
    if (PRESETS[novoTipo]) setPermissoes(JSON.parse(JSON.stringify(PRESETS[novoTipo])));
  }

  function setAcao(modulo: string, acao: Acao, valor: boolean) {
    setPermissoes((p) => ({ ...p, [modulo]: { ...p[modulo], [acao]: valor } }));
  }
  function marcarSecao(secaoId: string, valor: boolean) {
    const secao = SECOES.find((s) => s.id === secaoId);
    if (!secao) return;
    setPermissoes((p) => {
      const novo = { ...p };
      for (const m of secao.modulos) {
        novo[m.id] = { ...novo[m.id] };
        for (const a of m.acoes) novo[m.id][a] = valor;
      }
      return novo;
    });
  }

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Nome do perfil é obrigatório."); return; }
    setSalvando(true);
    const payload = { nome, tipo, cor, descricao, permissoes };
    try {
      const url = editando === "novo" ? "/api/perfis-acesso" : `/api/perfis-acesso/${editando}`;
      const res = await fetch(url, { method: editando === "novo" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar."); return; }
      const salvo = await res.json();
      setPerfis((p) => editando === "novo" ? [...p, { ...salvo, _count: { usuarios: 0, colaboradores: 0 } }] : p.map((x) => (x.id === editando ? { ...x, ...salvo } : x)));
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function excluir(p: any) {
    if (!confirm(`Excluir o perfil "${p.nome}"?`)) return;
    const res = await fetch(`/api/perfis-acesso/${p.id}`, { method: "DELETE" });
    if (!res.ok) { const e = await res.json(); alert(e.erro ?? "Erro ao excluir."); return; }
    setPerfis((lista) => lista.filter((x) => x.id !== p.id));
  }

  // Preview: módulos visíveis
  const modulosVisiveis = SECOES.flatMap((s) => s.modulos).filter((m) => permissoes[m.id]?.visualizar);

  if (loading) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;

  if (editando) {
    return (
      <div className="space-y-5">
        {erro && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}

        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">{editando === "novo" ? "Novo perfil de acesso" : "Editar perfil"}</h3>
          <button onClick={() => setEditando(null)} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        <FormGrid cols={3}>
          <FormField label="Nome do perfil" required className="sm:col-span-2"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Supervisor de Manutenção" /></FormField>
          <FormField label="Cor">
            <div className="flex items-center gap-2">
              <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="w-10 h-10 rounded border border-surface-border cursor-pointer" />
              <Input value={cor} onChange={(e) => setCor(e.target.value)} className="flex-1 font-mono text-xs" />
            </div>
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Tipo" hint="Trocar o tipo carrega um modelo de permissões">
            <Select value={tipo} onChange={(e) => aplicarPreset(e.target.value)}>
              {TIPOS.map((t) => <option key={t} value={t}>{TIPOS_PERFIL_LABEL[t]}</option>)}
            </Select>
          </FormField>
          <FormField label="Descrição"><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Resumo do perfil" /></FormField>
        </FormGrid>

        {/* Matriz de permissões */}
        <div className="space-y-5">
          {SECOES.map((secao) => (
            <div key={secao.id} className="border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-surface-alt border-b border-surface-border">
                <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">{secao.label}</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => marcarSecao(secao.id, true)} className="text-xs font-medium text-primary-600 hover:text-primary-700">Selecionar tudo</button>
                  <span className="text-ink-subtle">·</span>
                  <button type="button" onClick={() => marcarSecao(secao.id, false)} className="text-xs font-medium text-ink-muted hover:text-ink">Desmarcar</button>
                </div>
              </div>
              <div className="divide-y divide-surface-border">
                {secao.modulos.map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-4 px-4 py-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-[160px]">
                      <span className="text-lg leading-none">{m.icone}</span>
                      <span className="text-sm font-medium text-ink">{m.label}</span>
                    </div>
                    <div className="flex items-center gap-x-5 gap-y-2 flex-wrap justify-end">
                      {m.acoes.map((acao) => (
                        <label key={acao} className="flex items-center gap-1.5 cursor-pointer">
                          <MiniToggle checked={!!permissoes[m.id]?.[acao]} onChange={(v) => setAcao(m.id, acao, v)} />
                          <span className="text-xs text-ink-muted">{ACOES_LABEL[acao]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Preview */}
        <div className="flex items-start gap-2 bg-primary-50 border border-primary-100 rounded-lg px-4 py-3">
          <Eye className="w-4 h-4 text-primary-600 mt-0.5 shrink-0" />
          <p className="text-sm text-ink">
            <span className="font-semibold">Com estas permissões, este colaborador verá:</span>{" "}
            {modulosVisiveis.length > 0 ? modulosVisiveis.map((m) => m.label).join(", ") : "apenas o Dashboard"}.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Criar perfil" : "Salvar"}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">Defina o que cada perfil pode ver e fazer no sistema.</p>
        <Button type="button" onClick={abrirNovo}><Plus className="w-4 h-4" /> Novo Perfil</Button>
      </div>

      {perfis.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-10 border border-dashed border-surface-border rounded-xl">Nenhum perfil cadastrado.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {perfis.map((p) => {
            const vinculos = (p._count?.usuarios ?? 0) + (p._count?.colaboradores ?? 0);
            return (
              <div key={p.id} className="border border-surface-border rounded-xl overflow-hidden bg-white">
                <div className="h-1.5" style={{ backgroundColor: p.cor }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${p.cor}1a` }}>
                        <ShieldCheck className="w-4 h-4" style={{ color: p.cor }} />
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink truncate">{p.nome}</p>
                        <p className="text-xs text-ink-muted">{TIPOS_PERFIL_LABEL[p.tipo] ?? p.tipo}</p>
                      </div>
                    </div>
                    {p.padraoSistema && <span className="text-[10px] font-semibold bg-surface-alt text-ink-muted px-2 py-0.5 rounded-full shrink-0">Padrão</span>}
                  </div>
                  {p.descricao && <p className="text-xs text-ink-muted mt-2 line-clamp-2">{p.descricao}</p>}
                  <p className="text-xs text-ink-subtle mt-3 pt-3 border-t border-surface-border">{vinculos} colaborador(es)/usuário(s) vinculado(s)</p>
                  <div className="flex items-center gap-1 mt-3">
                    <Button type="button" variant="secondary" onClick={() => abrirEditar(p)} className="text-xs py-1.5 px-3 h-auto"><Pencil className="w-3.5 h-3.5" /> Editar</Button>
                    <Button type="button" variant="secondary" onClick={() => duplicar(p)} className="text-xs py-1.5 px-3 h-auto"><Copy className="w-3.5 h-3.5" /> Duplicar</Button>
                    <button
                      type="button"
                      onClick={() => excluir(p)}
                      disabled={p.padraoSistema || vinculos > 0}
                      title={p.padraoSistema ? "Perfil padrão não pode ser excluído" : vinculos > 0 ? "Há vínculos" : "Excluir"}
                      className="ml-auto p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-muted"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
