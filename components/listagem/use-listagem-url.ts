"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFiltrosLembrados } from "@/components/listagem/use-filtros-lembrados";

export type Visao = "lista" | "cards";

/** Espera depois da última tecla antes de buscar no servidor */
export const DEBOUNCE_BUSCA_MS = 300;

function lerStorage(chave: string): string | null {
  try { return window.localStorage.getItem(chave); } catch { return null; }
}
function gravarStorage(chave: string, valor: string) {
  try { window.localStorage.setItem(chave, valor); } catch { /* modo privado etc. */ }
}

/**
 * Estado das listagens com filtro na URL (Equipamentos, Veículos…):
 * - a URL é a fonte da verdade (busca/paginação rodam no servidor);
 * - o último filtro usado volta ao abrir a tela "limpa" (useFiltrosLembrados: por usuário e empresa, no dia);
 * - visão lista/cards é preferência pessoal;
 * - itens por página: a preferência do usuário (lerTamanhoPreferido) vale ao abrir qualquer lista;
 * - busca ao vivo com debounce (sem Enter).
 * `chave` separa o que cada tela guarda (ex.: "equipamentos", "veiculos"); `paramBusca` é o nome do
 * parâmetro da busca na URL ("q" ou, nas listas antigas, "busca").
 */
export function useListagemUrl({ chave, qAtual, paramBusca = "q", lembrarFiltros = true }: {
  chave: string; qAtual: string; paramBusca?: string;
  /** Restaurar o último filtro ao abrir a tela "limpa" (todas as listas; desligue só onde não faz sentido) */
  lembrarFiltros?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pendente, startTransition] = useTransition();
  const chaveVisao = `frivo:${chave}:visao`;

  const [visao, setVisao] = useState<Visao>("lista");
  const [busca, setBusca] = useState(qAtual);

  useEffect(() => {
    const v = lerStorage(chaveVisao);
    if (v === "cards" || v === "lista") setVisao(v);
  }, [chaveVisao]);
  function trocarVisao(v: Visao) { setVisao(v); gravarStorage(chaveVisao, v); }

  // Filtros lembrados (por usuário e empresa, no dia) e os itens por página preferidos: o hook único
  useFiltrosLembrados(chave, lembrarFiltros);

  /** Aplica mudanças na URL; por padrão volta para a página 1. */
  function navegar(mudancas: Record<string, string | null>, manterPagina = false) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    if (!manterPagina) p.delete("pagina");
    const qs = p.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: !manterPagina ? false : true }));
  }

  // Busca com debounce (servidor)
  useEffect(() => {
    if (busca.trim() === qAtual) return;
    const t = setTimeout(() => navegar({ [paramBusca]: busca.trim() || null }), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);
  useEffect(() => { setBusca(qAtual); }, [qAtual]);

  function limpar() {
    setBusca("");
    // Limpa os filtros, mas mantém o tamanho de página escolhido
    const por = sp.get("por");
    startTransition(() => router.replace(por ? `${pathname}?por=${por}` : pathname, { scroll: false }));
  }

  return { visao, trocarVisao, busca, setBusca, navegar, limpar, pendente };
}
