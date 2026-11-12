"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TAMANHO_PADRAO } from "@/lib/listagem";
import { lerTamanhoPreferido } from "@/components/listagem/listagem-ui";

export type Visao = "lista" | "cards";

/** Parâmetros que não fazem parte do "filtro salvo" (o tamanho da página é uma preferência à parte). */
const NAO_PERSISTIR = ["pagina", "por"];
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
 * - o último filtro usado é restaurado ao abrir a tela "limpa" (localStorage);
 * - visão lista/cards é preferência pessoal;
 * - itens por página: a preferência do usuário (lerTamanhoPreferido) vale ao abrir qualquer lista;
 * - busca ao vivo com debounce (sem Enter).
 * `chave` separa o que cada tela guarda (ex.: "equipamentos", "veiculos"); `paramBusca` é o nome do
 * parâmetro da busca na URL ("q" ou, nas listas antigas, "busca").
 */
export function useListagemUrl({ chave, qAtual, paramBusca = "q", lembrarFiltros = true }: {
  chave: string; qAtual: string; paramBusca?: string;
  /** Restaurar o último filtro ao abrir a tela "limpa" (Equipamentos, Veículos, Colaboradores) */
  lembrarFiltros?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pendente, startTransition] = useTransition();
  const chaveFiltros = `frivo:${chave}:filtros`;
  const chaveVisao = `frivo:${chave}:visao`;

  const [visao, setVisao] = useState<Visao>("lista");
  const [busca, setBusca] = useState(qAtual);

  useEffect(() => {
    const v = lerStorage(chaveVisao);
    if (v === "cards" || v === "lista") setVisao(v);
  }, [chaveVisao]);
  function trocarVisao(v: Visao) { setVisao(v); gravarStorage(chaveVisao, v); }

  // Filtros persistentes: ao abrir a tela "limpa", restaura o último filtro usado
  const restaurou = useRef(false);
  const restaurando = useRef(false);
  useEffect(() => {
    if (restaurou.current) return;
    restaurou.current = true;
    let p = new URLSearchParams(sp.toString());
    let mudou = false;
    if (lembrarFiltros && sp.toString() === "") {
      const salvo = lerStorage(chaveFiltros);
      if (salvo) { p = new URLSearchParams(salvo); p.delete("por"); mudou = true; }
    }
    // Itens por página: a preferência lembrada (se a URL não disser outro)
    const pref = lerTamanhoPreferido();
    if (!p.has("por") && pref && pref !== TAMANHO_PADRAO) { p.set("por", String(pref)); mudou = true; }
    if (mudou) {
      restaurando.current = true;
      router.replace(`${pathname}?${p}`, { scroll: false });
    }
  }, [sp, pathname, router, chaveFiltros, lembrarFiltros]);
  useEffect(() => {
    // Enquanto restaura, não sobrescreve o filtro salvo com a URL ainda vazia
    if (restaurando.current) {
      if (sp.toString() === "") return;
      restaurando.current = false;
    }
    const p = new URLSearchParams(sp.toString());
    NAO_PERSISTIR.forEach((k) => p.delete(k));
    gravarStorage(chaveFiltros, p.toString());
  }, [sp, chaveFiltros]);

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
 * Para listas que montam a URL por conta própria (OS, Contratos): ao abrir, aplica o tamanho de
 * página lembrado se a URL não disser outro.
 */
export function useTamanhoPreferido(aplicar: (por: string) => void) {
  const sp = useSearchParams();
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    const pref = lerTamanhoPreferido();
    if (!sp.get("por") && pref && pref !== TAMANHO_PADRAO) aplicar(String(pref));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
