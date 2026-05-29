"use client";

import { useState, useRef, useEffect } from "react";
import { cn, formatarMoeda } from "@/lib/utils";
import { Plus, Trash2, Search, X, Lock, LockOpen } from "lucide-react";

export interface ItemTabela {
  id: string;            // uuid local
  catalogoId?: string | null;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  observacao?: string | null;
  bloqueado?: boolean;
  origemPreco?: "contrato" | "padrao" | "fora_tabela";
  valorPadraoCadastro?: number;
}

export interface CatalogoItem {
  id: string;
  nome: string;
  descricao?: string | null;
  unidade?: string | null;
  valorPadrao?: unknown; // Decimal | number | null
}

export interface TabelaPrecoCliente {
  nome: string;
  tipo: string;
  precosBloqueados: boolean;
  itens: Record<string, { valorFinal: number; bloqueado: boolean; tipoPreco: string; descontoPercent: number | null }>;
}

interface ItensTabelaProps {
  titulo: string;
  labelAdicionar: string;
  catalogo: CatalogoItem[];
  itens: ItemTabela[];
  onChange: (itens: ItemTabela[]) => void;
  tabela?: TabelaPrecoCliente | null;
}

function novoId() {
  return Math.random().toString(36).slice(2);
}

export function ItensTabela({ titulo, labelAdicionar, catalogo, itens, onChange, tabela }: ItensTabelaProps) {
  function atualizar(id: string, patch: Partial<ItemTabela>) {
    onChange(itens.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function remover(id: string) {
    onChange(itens.filter((it) => it.id !== id));
  }
  function adicionarVazio() {
    onChange([
      ...itens,
      { id: novoId(), descricao: "", quantidade: 1, valorUnitario: 0 },
    ]);
  }
  function adicionarDoCatalogo(c: CatalogoItem) {
    const padrao = c.valorPadrao == null ? 0 : Number(c.valorPadrao);
    const tItem = tabela?.itens[c.id];
    let valorUnitario = padrao;
    let bloqueado = false;
    // Sem tabela vinculada: comportamento padrão (sem badge).
    // Com tabela: item presente => "contrato"; ausente (via "mostrar todos") => "fora_tabela".
    let origemPreco: ItemTabela["origemPreco"] = tabela ? "fora_tabela" : undefined;
    if (tItem) {
      valorUnitario = tItem.valorFinal;
      bloqueado = (tabela?.precosBloqueados ?? false) || tItem.bloqueado;
      origemPreco = "contrato";
    }
    onChange([
      ...itens,
      {
        id: novoId(),
        catalogoId: c.id,
        descricao: c.descricao ? `${c.nome} — ${c.descricao}` : c.nome,
        quantidade: 1,
        valorUnitario,
        bloqueado,
        origemPreco,
        valorPadraoCadastro: padrao,
      },
    ]);
  }

  const subtotal = itens.reduce(
    (acc, it) => acc + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0),
    0,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="section-title">{titulo}</h3>
        <div className="text-sm">
          <span className="text-ink-muted">Subtotal: </span>
          <span className="font-bold text-ink">{formatarMoeda(subtotal)}</span>
        </div>
      </div>

      <div className="overflow-x-auto border border-surface-border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase tracking-wider w-[40%]">
                Descrição
              </th>
              <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase tracking-wider w-20">Qtd</th>
              <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase tracking-wider w-32">Unitário</th>
              <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase tracking-wider w-32">Total</th>
              <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase tracking-wider">Observação</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-ink-subtle py-6 italic">
                  Nenhum item adicionado.
                </td>
              </tr>
            )}
            {itens.map((it) => {
              const total = (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0);
              return (
                <tr key={it.id} className="border-t border-surface-border">
                  <td className="px-3 py-2">
                    <input
                      value={it.descricao}
                      onChange={(e) => atualizar(it.id, { descricao: e.target.value })}
                      placeholder="Descrição do item"
                      className="w-full bg-transparent text-ink focus:outline-none focus:bg-primary-50/30 rounded px-1 py-0.5"
                    />
                    {it.origemPreco && (
                      <span
                        className={cn(
                          "inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded",
                          it.origemPreco === "contrato" && "bg-success-50 text-success-700",
                          it.origemPreco === "padrao" && "bg-slate-100 text-slate-500",
                          it.origemPreco === "fora_tabela" && "bg-amber-50 text-amber-700",
                        )}
                      >
                        {it.origemPreco === "contrato"
                          ? "Preço de contrato"
                          : it.origemPreco === "fora_tabela"
                            ? "⚠️ Fora da tabela"
                            : "Preço padrão"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={it.quantidade}
                      onChange={(e) => atualizar(it.id, { quantidade: Number(e.target.value) })}
                      className="w-full text-right bg-transparent text-ink focus:outline-none focus:bg-primary-50/30 rounded px-1 py-0.5"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {it.bloqueado ? (
                      <div
                        className="flex items-center justify-end gap-1 bg-surface-alt text-ink-muted rounded px-1.5 py-0.5 cursor-not-allowed"
                        title="Preço definido em contrato — não pode ser alterado"
                      >
                        <Lock className="w-3 h-3 shrink-0" />
                        <span className="font-medium">{formatarMoeda(Number(it.valorUnitario) || 0)}</span>
                      </div>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={it.valorUnitario}
                        onChange={(e) => atualizar(it.id, { valorUnitario: Number(e.target.value) })}
                        title={
                          it.origemPreco === "contrato" && it.valorPadraoCadastro != null && it.valorPadraoCadastro !== Number(it.valorUnitario)
                            ? `Preço padrão: ${formatarMoeda(it.valorPadraoCadastro)} · Aplicado: ${formatarMoeda(Number(it.valorUnitario) || 0)}`
                            : undefined
                        }
                        className="w-full text-right bg-transparent text-ink focus:outline-none focus:bg-primary-50/30 rounded px-1 py-0.5"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-ink">
                    {formatarMoeda(total)}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={it.observacao ?? ""}
                      onChange={(e) => atualizar(it.id, { observacao: e.target.value })}
                      placeholder="opcional"
                      className="w-full bg-transparent text-ink-muted focus:outline-none focus:bg-primary-50/30 rounded px-1 py-0.5 text-xs"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => remover(it.id)}
                      className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Remover"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BuscaCatalogo catalogo={catalogo} onSelect={adicionarDoCatalogo} placeholder={labelAdicionar} tabela={tabela} />
        <button
          type="button"
          onClick={adicionarVazio}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-3 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Linha em branco
        </button>
      </div>
    </div>
  );
}

function BuscaCatalogo({
  catalogo,
  onSelect,
  placeholder,
  tabela,
}: {
  catalogo: CatalogoItem[];
  onSelect: (c: CatalogoItem) => void;
  placeholder: string;
  tabela?: TabelaPrecoCliente | null;
}) {
  const [query, setQuery] = useState("");
  const [aberto, setAberto] = useState(false);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Quando o cliente tem tabela e não está no modo "mostrar todos",
  // a busca exibe apenas os itens presentes na tabela do cliente.
  const restritoTabela = !!tabela && !mostrarTodos;
  const base = restritoTabela ? catalogo.filter((c) => !!tabela!.itens[c.id]) : catalogo;

  const q = query.trim().toLowerCase();
  const filtrados = q
    ? base.filter((c) => c.nome.toLowerCase().includes(q) || (c.descricao ?? "").toLowerCase().includes(q))
    : base;

  // Preço exibido no dropdown: o da tabela quando o item pertence a ela.
  function precoExibido(c: CatalogoItem): { valor: number | null; contrato: boolean } {
    const t = tabela?.itens[c.id];
    if (t) return { valor: t.valorFinal, contrato: true };
    return { valor: c.valorPadrao != null ? Number(c.valorPadrao) : null, contrato: false };
  }

  return (
    <div className="relative flex-1 min-w-[240px]" ref={ref}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        placeholder={restritoTabela ? "Buscar na tabela do cliente..." : placeholder}
        className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-9 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {aberto && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border border-surface-border rounded-lg shadow-card-hover">
          {filtrados.length === 0 && (
            <p className="px-3 py-3 text-xs text-ink-subtle italic">
              {restritoTabela ? "Nenhum item na tabela do cliente. Use “Mostrar todos”." : "Nenhum item encontrado."}
            </p>
          )}
          {filtrados.slice(0, 20).map((c) => {
            const pe = precoExibido(c);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c); setQuery(""); setAberto(false); }}
                className="w-full text-left px-3 py-2 hover:bg-primary-50 border-b border-surface-border last:border-0 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{c.nome}</p>
                  {c.descricao && <p className="text-xs text-ink-muted truncate">{c.descricao}</p>}
                </div>
                <span className={cn(
                  "text-xs font-mono shrink-0",
                  pe.valor == null ? "text-ink-subtle italic" : pe.contrato ? "text-success-700 font-semibold" : "text-ink-muted",
                )}>
                  {pe.valor != null ? formatarMoeda(pe.valor) : "—"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Alterna entre "só da tabela" e "todos" quando há tabela vinculada */}
      {tabela && (
        <button
          type="button"
          onClick={() => setMostrarTodos((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"
          title={mostrarTodos ? "Mostrar apenas os itens da tabela do cliente" : "Mostrar todos os serviços/produtos cadastrados"}
        >
          {mostrarTodos ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
          {mostrarTodos ? "Mostrar só da tabela" : "Mostrar todos os serviços"}
        </button>
      )}
    </div>
  );
}
