"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn, formatarMoeda, LABELS_TIPO_TABELA_PRECO } from "@/lib/utils";
import { calcularValorFinalTabela } from "@/lib/tabela-preco-helpers";
import { Plus, Pencil, Trash2, X, Check, Search, Lock, Tags } from "lucide-react";

interface CatalogoItem { id: string; nome: string; valorPadrao: number; kind: "SERVICO" | "PRODUTO" }
interface ItemEdit {
  _id: string; catalogoId: string; kind: "SERVICO" | "PRODUTO"; nome: string; valorPadrao: number;
  tipoPreco: "VALOR_FIXO" | "DESCONTO_PERCENTUAL"; valorFixo: string; descontoPercent: string; bloqueado: boolean;
}
interface Tabela {
  id: string; nome: string; descricao?: string | null; tipo: string;
  precosBloqueados: boolean; ativo: boolean;
  _count?: { itens: number; clientes: number };
}

function uid() { return Math.random().toString(36).slice(2); }

export function TabelasPrecoClient() {
  const [tabelas, setTabelas] = useState<Tabela[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState("PERSONALIZADA");
  const [precosBloqueados, setPrecosBloqueados] = useState(false);
  const [itens, setItens] = useState<ItemEdit[]>([]);

  useEffect(() => {
    fetch("/api/tabelas-preco").then((r) => r.json()).then((d) => setTabelas(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
    Promise.all([
      fetch("/api/servicos").then((r) => r.json()).catch(() => []),
      fetch("/api/produtos").then((r) => r.json()).catch(() => []),
    ]).then(([s, p]) => {
      const cat: CatalogoItem[] = [
        ...(Array.isArray(s) ? s : []).map((x: any) => ({ id: x.id, nome: x.nome, valorPadrao: x.valorPadrao ? Number(x.valorPadrao) : 0, kind: "SERVICO" as const })),
        ...(Array.isArray(p) ? p : []).map((x: any) => ({ id: x.id, nome: x.nome, valorPadrao: x.valorPadrao ? Number(x.valorPadrao) : 0, kind: "PRODUTO" as const })),
      ];
      setCatalogo(cat);
    });
  }, []);

  function abrirNovo() {
    setNome(""); setDescricao(""); setTipo("PERSONALIZADA"); setPrecosBloqueados(false); setItens([]); setErro("");
    setEditando("novo");
  }

  async function abrirEditar(t: Tabela) {
    setErro("");
    const res = await fetch(`/api/tabelas-preco/${t.id}`);
    const full = await res.json();
    setNome(full.nome); setDescricao(full.descricao ?? ""); setTipo(full.tipo); setPrecosBloqueados(full.precosBloqueados);
    setItens((full.itens ?? []).map((it: any) => {
      const cat = it.servico ?? it.produto;
      return {
        _id: uid(),
        catalogoId: it.servicoId ?? it.produtoId ?? "",
        kind: it.servicoId ? "SERVICO" : "PRODUTO",
        nome: cat?.nome ?? "(item removido)",
        valorPadrao: cat?.valorPadrao ? Number(cat.valorPadrao) : 0,
        tipoPreco: it.tipoPreco,
        valorFixo: it.valorFixo != null ? String(Number(it.valorFixo)) : "",
        descontoPercent: it.descontoPercent != null ? String(Number(it.descontoPercent)) : "",
        bloqueado: it.bloqueado,
      };
    }));
    setEditando(t.id);
  }

  function adicionarDoCatalogo(c: CatalogoItem) {
    if (itens.some((i) => i.catalogoId === c.id)) return;
    setItens((p) => [...p, {
      _id: uid(), catalogoId: c.id, kind: c.kind, nome: c.nome, valorPadrao: c.valorPadrao,
      tipoPreco: "VALOR_FIXO", valorFixo: String(c.valorPadrao || ""), descontoPercent: "", bloqueado: false,
    }]);
  }
  function patch(id: string, p: Partial<ItemEdit>) {
    setItens((arr) => arr.map((i) => (i._id === id ? { ...i, ...p } : i)));
  }

  async function salvar() {
    if (!nome.trim()) return setErro("Informe o nome da tabela.");
    const payload = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      tipo,
      precosBloqueados,
      ativo: true,
      itens: itens.map((i) => ({
        servicoId: i.kind === "SERVICO" ? i.catalogoId : null,
        produtoId: i.kind === "PRODUTO" ? i.catalogoId : null,
        tipoPreco: i.tipoPreco,
        valorFixo: i.tipoPreco === "VALOR_FIXO" ? (i.valorFixo === "" ? null : Number(i.valorFixo)) : null,
        descontoPercent: i.tipoPreco === "DESCONTO_PERCENTUAL" ? (i.descontoPercent === "" ? null : Number(i.descontoPercent)) : null,
        bloqueado: i.bloqueado,
      })),
    };
    setSalvando(true); setErro("");
    try {
      const url = editando === "novo" ? "/api/tabelas-preco" : `/api/tabelas-preco/${editando}`;
      const method = editando === "novo" ? "POST" : "PUT";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Erro ao salvar."); return; }
      // recarrega lista (para atualizar contagens)
      const lista = await fetch("/api/tabelas-preco").then((r) => r.json());
      setTabelas(Array.isArray(lista) ? lista : []);
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!confirm("Desativar esta tabela?")) return;
    await fetch(`/api/tabelas-preco/${id}`, { method: "DELETE" });
    setTabelas((p) => p.map((t) => (t.id === id ? { ...t, ativo: false } : t)));
  }

  const ativas = tabelas.filter((t) => t.ativo !== false);

  if (loading) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;

  if (editando) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-primary-700">{editando === "novo" ? "Nova tabela de preços" : "Editar tabela"}</h4>
          <button onClick={() => setEditando(null)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

        <FormGrid cols={2}>
          <FormField label="Nome" required><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Contrato, Belma" /></FormField>
          <FormField label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(LABELS_TIPO_TABELA_PRECO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormField>
        </FormGrid>
        <FormField label="Descrição"><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} /></FormField>
        <div className="border-t border-surface-border pt-1">
          <ToggleSwitch
            label="Preços bloqueados"
            description="Quando ativo, os valores desta tabela não podem ser alterados no orçamento/medição."
            checked={precosBloqueados}
            onChange={setPrecosBloqueados}
          />
        </div>

        <div>
          <h5 className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Itens da tabela</h5>
          <BuscaCatalogo catalogo={catalogo} jaAdicionados={itens.map((i) => i.catalogoId)} onSelect={adicionarDoCatalogo} />

          <div className="space-y-2 mt-3">
            {itens.length === 0 && <p className="text-sm text-ink-subtle text-center py-4 italic">Nenhum item. Busque um serviço ou produto acima.</p>}
            {itens.map((it) => {
              const valorFinal = calcularValorFinalTabela(it.tipoPreco, it.valorFixo === "" ? 0 : Number(it.valorFixo), it.descontoPercent === "" ? 0 : Number(it.descontoPercent), it.valorPadrao);
              return (
                <div key={it._id} className="border border-surface-border rounded-lg p-3 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", it.kind === "SERVICO" ? "bg-primary-50 text-primary-700" : "bg-violet-50 text-violet-700")}>{it.kind === "SERVICO" ? "Serviço" : "Produto"}</span>
                      <span className="text-sm font-medium text-ink truncate">{it.nome}</span>
                      <span className="text-xs text-ink-subtle">(padrão {formatarMoeda(it.valorPadrao)})</span>
                    </div>
                    <button type="button" onClick={() => setItens((a) => a.filter((x) => x._id !== it._id))} className="p-1.5 text-ink-muted hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <FormGrid cols={3}>
                    <FormField label="Tipo de preço">
                      <Select value={it.tipoPreco} onChange={(e) => patch(it._id, { tipoPreco: e.target.value as ItemEdit["tipoPreco"] })}>
                        <option value="VALOR_FIXO">Valor fixo</option>
                        <option value="DESCONTO_PERCENTUAL">Desconto percentual</option>
                      </Select>
                    </FormField>
                    {it.tipoPreco === "VALOR_FIXO" ? (
                      <FormField label="Valor (R$)"><Input type="number" min="0" step="0.01" value={it.valorFixo} onChange={(e) => patch(it._id, { valorFixo: e.target.value })} /></FormField>
                    ) : (
                      <FormField label="Desconto (%)"><Input type="number" min="0" max="100" step="0.01" value={it.descontoPercent} onChange={(e) => patch(it._id, { descontoPercent: e.target.value })} /></FormField>
                    )}
                    <FormField label="Valor final">
                      <div className="input-base bg-surface-alt font-semibold text-success-700 flex items-center">{formatarMoeda(valorFinal)}</div>
                    </FormField>
                  </FormGrid>
                  <ToggleSwitch label="Preço bloqueado (este item)" checked={it.bloqueado} onChange={(v) => patch(it._id, { bloqueado: v })} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
          <Button loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {editando === "novo" ? "Criar tabela" : "Salvar"}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ativas.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-8">Nenhuma tabela de preços cadastrada.</p>
      ) : (
        <div className="space-y-2">
          {ativas.map((t) => (
            <div key={t.id} className="border border-surface-border rounded-lg p-3 flex items-center justify-between hover:bg-surface-alt/40 transition-colors">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink flex items-center gap-2">
                  <Tags className="w-4 h-4 text-primary-600" /> {t.nome}
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">{LABELS_TIPO_TABELA_PRECO[t.tipo]}</span>
                  {t.precosBloqueados && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"><Lock className="w-3 h-3" /> Bloqueada</span>}
                </p>
                <p className="text-xs text-ink-muted">{t.descricao || "—"} · {t._count?.itens ?? 0} item(ns) · {t._count?.clientes ?? 0} cliente(s)</p>
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
        <Plus className="w-4 h-4" /> Nova tabela de preços
      </Button>
    </div>
  );
}

function BuscaCatalogo({ catalogo, jaAdicionados, onSelect }: { catalogo: CatalogoItem[]; jaAdicionados: string[]; onSelect: (c: CatalogoItem) => void }) {
  const [query, setQuery] = useState("");
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtrados = catalogo.filter((c) => !jaAdicionados.includes(c.id) && (!q || c.nome.toLowerCase().includes(q)));

  return (
    <div className="relative" ref={ref}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        placeholder="Buscar serviço ou produto para adicionar..."
        className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
      />
      {aberto && filtrados.length > 0 && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border border-surface-border rounded-lg shadow-card-hover">
          {filtrados.slice(0, 20).map((c) => (
            <button key={c.id} type="button" onClick={() => { onSelect(c); setQuery(""); setAberto(false); }}
              className="w-full text-left px-3 py-2 hover:bg-primary-50 border-b border-surface-border last:border-0 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 min-w-0">
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", c.kind === "SERVICO" ? "bg-primary-50 text-primary-700" : "bg-violet-50 text-violet-700")}>{c.kind === "SERVICO" ? "S" : "P"}</span>
                <span className="text-sm text-ink truncate">{c.nome}</span>
              </span>
              <span className="text-xs font-mono text-ink-muted shrink-0">{formatarMoeda(c.valorPadrao)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
