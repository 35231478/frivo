"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { TAMANHO_PADRAO } from "@/lib/listagem";
import { chaveHojeBR } from "@/lib/fuso";
import { abriuLimpa, chaveFiltrosLembrados, comNavegacao, filtroDeHoje, lembrado } from "@/lib/listagem/filtros-lembrados";
import { lerTamanhoPreferido } from "@/components/listagem/listagem-ui";

function lerStorage(chave: string): string | null {
  try { return window.localStorage.getItem(chave); } catch { return null; }
}
function gravarStorage(chave: string, valor: string) {
  try { window.localStorage.setItem(chave, valor); } catch { /* modo privado, cota cheia: segue sem lembrar */ }
}

/**
 * FILTROS LEMBRADOS — o hook único de todas as listas com filtro na URL (useListagemUrl, que serve o
 * <ListaUrl> das listas do servidor, e a lista de OS, que monta a própria URL). Regra em
 * lib/listagem/filtros-lembrados: por usuário e empresa, no navegador, vale no mesmo dia de Brasília, e a
 * URL com parâmetros vence.
 *
 * Ao abrir limpa: restaura o filtro de hoje e aplica os itens por página preferidos (se a URL não disser
 * outro) — numa troca só de URL. A cada mudança de URL, guarda. Sem sessão (fora do painel), não lembra.
 * `navegacao`: parâmetros da TELA, não filtro (ex.: `aba`, quando cada aba tem os seus filtros): não contam para
 * "abriu limpa", não são guardados e ficam como estão ao restaurar.
 */
export function useFiltrosLembrados(tela: string, ativo = true, navegacao: readonly string[] = []) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  // Quem e em qual empresa: o provedor do painel (sem ele — fora do painel, em testes — o hook só não lembra)
  const { usuarioId, empresaId } = usePermissoes();
  const chave = ativo && usuarioId && empresaId ? chaveFiltrosLembrados(empresaId, usuarioId, tela) : null;
  const restaurou = useRef(false);
  const restaurando = useRef(false);

  useEffect(() => {
    if (restaurou.current) return;
    restaurou.current = true;
    let p = new URLSearchParams(sp.toString());
    let mudou = false;
    if (chave && abriuLimpa(sp.toString(), navegacao)) {
      const salvo = filtroDeHoje(lerStorage(chave), chaveHojeBR());
      if (salvo) { p = new URLSearchParams(comNavegacao(salvo, sp.toString(), navegacao)); mudou = true; }
    }
    // Itens por página: a preferência lembrada (se nem a URL nem o filtro lembrado disserem outro)
    const pref = lerTamanhoPreferido();
    if (!p.has("por") && pref && pref !== TAMANHO_PADRAO) { p.set("por", String(pref)); mudou = true; }
    if (mudou) {
      restaurando.current = true;
      router.replace(`${pathname}?${p}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, pathname, router, chave]);

  useEffect(() => {
    if (!chave) return;
    // Enquanto restaura, não grava por cima a URL ainda vazia
    if (restaurando.current) {
      if (abriuLimpa(sp.toString(), navegacao)) return;
      restaurando.current = false;
    }
    gravarStorage(chave, lembrado(sp.toString(), chaveHojeBR(), navegacao));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, chave]);
}
