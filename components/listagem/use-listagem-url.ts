"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type Visao = "lista" | "cards";

/** Parâmetros que não fazem parte do "filtro salvo". */
const NAO_PERSISTIR = ["pagina"];

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
 * - busca com debounce.
 * `chave` separa o que cada tela guarda (ex.: "equipamentos", "veiculos").
 */
export function useListagemUrl({ chave, qAtual }: { chave: string; qAtual: string }) {
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
    if (sp.toString() === "") {
      const salvo = lerStorage(chaveFiltros);
      if (salvo) {
        restaurando.current = true;
        router.replace(`${pathname}?${salvo}`, { scroll: false });
      }
    }
  }, [sp, pathname, router, chaveFiltros]);
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
    const t = setTimeout(() => navegar({ q: busca.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);
  useEffect(() => { setBusca(qAtual); }, [qAtual]);

  function limpar() {
    setBusca("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  return { visao, trocarVisao, busca, setBusca, navegar, limpar, pendente };
}
