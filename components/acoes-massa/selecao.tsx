"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ENTIDADE, MAX_SELECAO, podeAcao, podeExportar, type AcaoItem, type Entidade } from "@/lib/acoes-massa/acoes";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/** O perfil tem alguma ação em massa nesta lista? (sem nenhuma, a lista nem mostra os checkboxes) */
export function useAcoesMassaDisponiveis(entidade: Entidade) {
  const { permissoes, role } = usePermissoes();
  return podeExportar(permissoes, role, entidade)
    || (Object.keys(ENTIDADE[entidade].acoes) as AcaoItem[]).some((a) => podeAcao(permissoes, role, entidade, a));
}

/**
 * Seleção para ações em massa — padrão reutilizável em qualquer lista:
 *
 *   <SelecaoMassaProvider entidade="clientes" idsPagina={ids} total={total}>
 *     <CheckboxPagina />            ← no cabeçalho da tabela
 *     <CheckboxLinha id={c.id} />   ← em cada linha
 *     <BarraAcoesMassa />           ← aparece quando há seleção
 *   </SelecaoMassaProvider>
 *
 * "Selecionar todos que batem no filtro" pede os ids ao servidor com o filtro atual da URL
 * (o mesmo where da página). Trocar de filtro limpa a seleção; trocar de página não.
 */

interface Ctx {
  entidade: Entidade;
  selecionados: Set<string>;
  idsPagina: string[];
  total: number;
  /** Filtro atual (querystring sem paginação) */
  filtro: string;
  /** Todos os do filtro foram selecionados (e quantos eram) */
  todosDoFiltro: boolean;
  alternar: (id: string, marcar?: boolean) => void;
  alternarPagina: (marcar: boolean) => void;
  selecionarFiltro: () => Promise<void>;
  limpar: () => void;
  carregandoFiltro: boolean;
  erroFiltro: string;
}

const SelecaoCtx = createContext<Ctx | null>(null);

export function useSelecaoMassa() {
  const c = useContext(SelecaoCtx);
  if (!c) throw new Error("useSelecaoMassa fora de SelecaoMassaProvider");
  return c;
}

const PARAMS_PAGINACAO = ["pagina", "page", "por", "porPagina", "sort", "dir", "ordem", "view"];

export function SelecaoMassaProvider({ entidade, idsPagina, total, children }: {
  entidade: Entidade; idsPagina: string[]; total: number; children: React.ReactNode;
}) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const filtro = useMemo(() => {
    const p = new URLSearchParams(sp.toString());
    for (const k of PARAMS_PAGINACAO) p.delete(k);
    p.sort();
    return p.toString();
  }, [sp]);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [todosDoFiltro, setTodosDoFiltro] = useState(false);
  const [carregandoFiltro, setCarregandoFiltro] = useState(false);
  const [erroFiltro, setErroFiltro] = useState("");

  // Filtro (ou lista) mudou: a seleção antiga não vale mais
  const chave = `${pathname}?${filtro}`;
  const anterior = useRef(chave);
  useEffect(() => {
    if (anterior.current !== chave) { anterior.current = chave; setSelecionados(new Set()); setTodosDoFiltro(false); setErroFiltro(""); }
  }, [chave]);

  const alternar = useCallback((id: string, marcar?: boolean) => {
    setTodosDoFiltro(false);
    setSelecionados((s) => {
      const n = new Set(s);
      const vai = marcar ?? !n.has(id);
      if (vai) { if (n.size < MAX_SELECAO) n.add(id); } else n.delete(id);
      return n;
    });
  }, []);

  const alternarPagina = useCallback((marcar: boolean) => {
    setTodosDoFiltro(false);
    setSelecionados((s) => {
      const n = new Set(s);
      for (const id of idsPagina) { if (marcar) { if (n.size < MAX_SELECAO) n.add(id); } else n.delete(id); }
      return n;
    });
  }, [idsPagina]);

  const selecionarFiltro = useCallback(async () => {
    setCarregandoFiltro(true); setErroFiltro("");
    try {
      const r = await fetch("/api/acoes-massa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entidade, acao: "ids-do-filtro", filtro }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErroFiltro(d.erro ?? "Não foi possível selecionar todos."); return; }
      setSelecionados(new Set(d.ids as string[]));
      setTodosDoFiltro(true);
    } catch {
      setErroFiltro("Erro de conexão.");
    } finally {
      setCarregandoFiltro(false);
    }
  }, [entidade, filtro]);

  const limpar = useCallback(() => { setSelecionados(new Set()); setTodosDoFiltro(false); setErroFiltro(""); }, []);

  const value = useMemo<Ctx>(() => ({
    entidade, selecionados, idsPagina, total, filtro, todosDoFiltro, alternar, alternarPagina, selecionarFiltro, limpar, carregandoFiltro, erroFiltro,
  }), [entidade, selecionados, idsPagina, total, filtro, todosDoFiltro, alternar, alternarPagina, selecionarFiltro, limpar, carregandoFiltro, erroFiltro]);

  return <SelecaoCtx.Provider value={value}>{children}</SelecaoCtx.Provider>;
}

const clsCheckbox = "w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500 cursor-pointer align-middle";

/** Checkbox de uma linha. Não deixa o clique "vazar" para o link/linha clicável. */
export function CheckboxLinha({ id, rotulo, className }: { id: string; rotulo?: string; className?: string }) {
  const { selecionados, alternar } = useSelecaoMassa();
  return (
    <span className={cn("inline-flex items-center justify-center p-1 -m-1", className)} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox" className={clsCheckbox} checked={selecionados.has(id)} data-selecao-linha={id}
        aria-label={rotulo ? `Selecionar ${rotulo}` : "Selecionar"}
        onChange={(e) => alternar(id, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
    </span>
  );
}

/** "Selecionar todos desta página" (fica indeterminado quando só parte da página está marcada). */
export function CheckboxPagina({ className }: { className?: string }) {
  const { selecionados, idsPagina, alternarPagina } = useSelecaoMassa();
  const marcados = idsPagina.filter((id) => selecionados.has(id)).length;
  const todos = idsPagina.length > 0 && marcados === idsPagina.length;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = marcados > 0 && !todos; }, [marcados, todos]);
  if (idsPagina.length === 0) return null;
  return (
    <input
      ref={ref} type="checkbox" className={cn(clsCheckbox, className)} checked={todos} data-selecao-pagina
      aria-label={todos ? "Desmarcar todos desta página" : "Selecionar todos desta página"}
      title={todos ? "Desmarcar todos desta página" : `Selecionar os ${idsPagina.length} desta página`}
      onChange={(e) => alternarPagina(e.target.checked)}
    />
  );
}
