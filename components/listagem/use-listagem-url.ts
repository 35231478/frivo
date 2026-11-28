"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFiltrosLembrados } from "@/components/listagem/use-filtros-lembrados";

export type Visao = "lista" | "cards";
const SEM_NAVEGACAO: readonly string[] = [];

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
export function useListagemUrl({ chave, qAtual, paramBusca = "q", lembrarFiltros = true, navegacao = SEM_NAVEGACAO }: {
  chave: string; qAtual: string; paramBusca?: string;
  /** Restaurar o último filtro ao abrir a tela "limpa" (todas as listas; desligue só onde não faz sentido) */
  lembrarFiltros?: boolean;
  /** Parâmetros da tela que não são filtro (ex.: `aba`): useFiltrosLembrados */
  navegacao?: readonly string[];
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
  useFiltrosLembrados(chave, lembrarFiltros, navegacao);

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

/**
 * Um filtro de lista filtrada NO NAVEGADOR (QR Codes, Checklists preenchidos, Despesas de campo) espelhado na
 * URL: a tela responde na hora (estado) e o valor vai para a URL — e daí para os filtros lembrados
 * (useListagemUrl › useFiltrosLembrados), o mesmo das outras listas. A URL mudando (link do sino, filtro
 * restaurado) atualiza o estado. `vazio`: o valor padrão, que não vai para a URL. `extra`: parâmetros que vão
 * junto (ex.: a `aba` da tela). `ativo = false`: só estado (a lista embutida noutra tela, sem URL própria).
 */
export function useFiltroUrl(param: string, navegar: (m: Record<string, string | null>) => void, { vazio = "", extra, ativo = true }: {
  vazio?: string; extra?: Record<string, string>; ativo?: boolean;
} = {}): [string, (v: string) => void] {
  const sp = useSearchParams();
  const daUrl = ativo ? sp.get(param) || vazio : vazio;
  const [valor, setValor] = useState(daUrl);
  useEffect(() => { if (ativo) setValor(daUrl); }, [daUrl, ativo]);
  const mudar = (v: string) => {
    setValor(v);
    if (ativo) navegar({ [param]: v === vazio ? null : v, ...extra });
  };
  return [valor, mudar];
}
