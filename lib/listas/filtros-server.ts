/**
 * O filtro da lista de OS como as telas e as exportações usam, com o que precisa do banco para ser
 * montado. Hoje é um só: o "Prazo de atendimento" (`?atendimento=vencendo|estourado`), cujas OS são
 * classificadas pela regra única (lib/atendimento/prazo.ts) e entram no filtro como uma lista de ids.
 * Tudo o mais é `whereOrdens`, sem banco.
 */
import { ALERTAS_ATENDIMENTO, type FiltroAtendimento } from "@/lib/atendimento/prazo";
import { comEscopo, filtroOrdens, type QuemVe } from "@/lib/escopo/proprios";
import { idsPorAtendimento } from "@/lib/atendimento/prazo-server";
import { whereOrdens } from "./filtros";

type SP = Parameters<typeof whereOrdens>[1];

export const filtroAtendimento = (valor: string | undefined | null): FiltroAtendimento | null =>
  (ALERTAS_ATENDIMENTO as readonly string[]).includes(valor ?? "") ? (valor as FiltroAtendimento) : null;

/** `quem`: COM-1 — com "Ver só os próprios" em OS, só as OS do escopo da pessoa (lista, contagem e exportação). */
export async function whereOrdensDaLista(empresaId: string, sp: SP, agora: Date = new Date(), quem?: QuemVe) {
  const filtro = filtroAtendimento(sp.atendimento);
  return comEscopo(whereOrdens(empresaId, sp, agora, filtro ? await idsPorAtendimento(empresaId, filtro, agora) : null), filtroOrdens(quem));
}
