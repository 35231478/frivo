"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Seleção de linhas numa lista — a parte que a `TabelaPro` e os cartões do celular precisam: QUAIS
 * ids estão marcados. Dois provedores alimentam este contexto:
 *  - `SelecaoMassaProvider` (components/acoes-massa/selecao): listas com ações em massa (OS,
 *    orçamentos, cadastros), seleção que atravessa páginas e "selecionar todos do filtro";
 *  - `SelecaoLinhasProvider` (aqui): listas sem ações em massa (Contas a Receber/Pagar, NFS-e),
 *    seleção da página — serve ao realce da linha e ao painel "Total dos N selecionados".
 * A `TabelaPro` lê o contexto e pinta a linha marcada (PLANILHA.linhaSelecionada), em qualquer tela.
 */
export const SelecionadosCtx = createContext<ReadonlySet<string> | null>(null);

/** Os ids marcados na lista em volta (null = a lista não tem seleção) */
export const useLinhasSelecionadas = () => useContext(SelecionadosCtx);

export function SelecionadosProvider({ selecionados, children }: { selecionados: ReadonlySet<string>; children: ReactNode }) {
  return <SelecionadosCtx.Provider value={selecionados}>{children}</SelecionadosCtx.Provider>;
}

interface CtxLinhas {
  selecionados: ReadonlySet<string>;
  idsPagina: string[];
  alternar: (id: string, marcar?: boolean) => void;
  alternarPagina: (marcar: boolean) => void;
  limpar: () => void;
}
const SelecaoLinhasCtx = createContext<CtxLinhas | null>(null);

export function useSelecaoLinhas() {
  const c = useContext(SelecaoLinhasCtx);
  if (!c) throw new Error("useSelecaoLinhas fora de SelecaoLinhasProvider");
  return c;
}

/**
 * Seleção simples da página: marcar/desmarcar uma linha ou a página inteira. Quando a página muda
 * (outros ids: filtro, período, paginação), a seleção zera — assim o que está marcado está sempre
 * na tela, e o painel de totais soma o que o usuário vê.
 */
export function SelecaoLinhasProvider({ idsPagina, children }: { idsPagina: string[]; children: ReactNode }) {
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const chave = idsPagina.join("|");
  const anterior = useRef(chave);
  useEffect(() => {
    if (anterior.current !== chave) { anterior.current = chave; setSelecionados(new Set()); }
  }, [chave]);

  const alternar = useCallback((id: string, marcar?: boolean) => {
    setSelecionados((s) => {
      const n = new Set(s);
      if (marcar ?? !n.has(id)) n.add(id); else n.delete(id);
      return n;
    });
  }, []);
  const alternarPagina = useCallback((marcar: boolean) => {
    setSelecionados((s) => {
      const n = new Set(s);
      for (const id of idsPagina) { if (marcar) n.add(id); else n.delete(id); }
      return n;
    });
  }, [idsPagina]);
  const limpar = useCallback(() => setSelecionados(new Set()), []);

  const value = useMemo<CtxLinhas>(() => ({ selecionados, idsPagina, alternar, alternarPagina, limpar }), [selecionados, idsPagina, alternar, alternarPagina, limpar]);
  return (
    <SelecaoLinhasCtx.Provider value={value}>
      <SelecionadosProvider selecionados={selecionados}>{children}</SelecionadosProvider>
    </SelecaoLinhasCtx.Provider>
  );
}

const clsCheckbox = "w-4 h-4 rounded border-surface-border accent-acento cursor-pointer align-middle";

/** Caixa de uma linha (mesma cara da seleção em massa). Não deixa o clique "vazar" para a linha/link. */
export function CheckboxSelecao({ id, rotulo, className, ...resto }: { id: string; rotulo?: string; className?: string } & Record<`data-${string}`, string | undefined>) {
  const { selecionados, alternar } = useSelecaoLinhas();
  return (
    <span className={cn("inline-flex items-center justify-center p-1 -m-1", className)} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox" className={clsCheckbox} checked={selecionados.has(id)} data-selecao-linha={id} {...resto}
        aria-label={rotulo ? `Selecionar ${rotulo}` : "Selecionar"}
        onChange={(e) => alternar(id, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
    </span>
  );
}

/** "Selecionar todos desta página" (indeterminado quando só parte da página está marcada). */
export function CheckboxSelecaoPagina({ className }: { className?: string }) {
  const { selecionados, idsPagina, alternarPagina } = useSelecaoLinhas();
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
