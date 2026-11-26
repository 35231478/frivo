"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * O NOME do registro na trilha do topo (migalha): "Clientes › Clínica Vida Plena", "Ordens de serviço ›
 * OS-2024-0001" — em vez de "Detalhes". A página de detalhe já carregou o registro: ela só avisa o nome
 * aqui (<NomeNaTrilha id nome />), sem consulta nova e sem permissão nova (quem chegou à página já pode vê-la).
 *
 * O registro é guardado SÓ NO NAVEGADOR (no efeito, nunca na renderização): no servidor, um estado de
 * módulo seria compartilhado entre requisições — e entre empresas. Sem nome registrado, a trilha mostra
 * "Detalhes", como antes.
 */
const nomes = new Map<string, string>();
const ouvintes = new Set<() => void>();
let versao = 0;
const avisar = () => { versao++; ouvintes.forEach((f) => f()); };

export function NomeNaTrilha({ id, nome }: { id: string; nome: string | null | undefined }) {
  useEffect(() => {
    const n = (nome ?? "").trim();
    if (!id || !n || nomes.get(id) === n) return;
    nomes.set(id, n);
    avisar();
  }, [id, nome]);
  return null;
}

/** O header lê os nomes registrados (e redesenha quando chega um novo). */
export function useNomesDaTrilha(): ReadonlyMap<string, string> {
  useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
    () => versao,
    () => 0,
  );
  return nomes;
}
