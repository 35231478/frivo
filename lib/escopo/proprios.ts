/**
 * COM-1 — escopo "Ver só os próprios" (marca RESTRITIVA dos perfis de acesso, em Orçamentos e em Ordens de serviço).
 * Com a marca, a pessoa vê e busca SÓ:
 *  - orçamentos: aqueles em que ela é o VENDEDOR;
 *  - OS: as ligadas aos orçamentos dela (o vendedor da OS ou do orçamento de origem) ou criadas por ela.
 * O filtro é do SERVIDOR (listas, busca, painel, sino, relatórios, exportação e rotas da API). ADMIN nunca é limitado.
 * Regra pura: sem banco (o guarda das rotas por id está em ./proprios-server).
 */
import type { Prisma } from "@prisma/client";
import { pode, type Permissoes } from "@/lib/permissoes";

export interface QuemVe { id?: string | null; role?: string | null; permissoes?: Permissoes | null }

const ehAdmin = (u: QuemVe) => u.role === "ADMIN" || u.role === "SUPER_ADMIN";

/** A pessoa só vê os próprios neste módulo? ("orcamentos" | "ordens") */
export function soProprios(u: QuemVe | null | undefined, modulo: "orcamentos" | "ordens"): boolean {
  if (!u || ehAdmin(u)) return false;
  return pode(u.permissoes ?? null, modulo, "verSoProprios", u.role ?? undefined);
}

/** Sem id não há "próprios": a lista fica vazia (nunca vaza por falta do id). */
const NENHUM = "__sem_usuario__";

/** O filtro dos orçamentos (vazio = sem limite). Junte com AND ao `where` que já existe. */
export function filtroOrcamentos(u: QuemVe | null | undefined): Prisma.OrcamentoWhereInput {
  return soProprios(u, "orcamentos") ? { vendedorId: u!.id || NENHUM } : {};
}

/** O filtro das OS (vazio = sem limite): as do vendedor, as dos orçamentos dele e as que ele criou. */
export function filtroOrdens(u: QuemVe | null | undefined): Prisma.OrdemServicoWhereInput {
  if (!soProprios(u, "ordens")) return {};
  const id = u!.id || NENHUM;
  return { OR: [{ vendedorId: id }, { orcamentoOrigem: { vendedorId: id } }, { criadoPorId: id }] };
}

/**
 * COM-1.1 — a lista de clientes com "Ver só os próprios" em OS: a contagem de OS é só a das OS da pessoa, e
 * ordenar pela contagem (que dependeria do volume dos outros) volta para a ordem padrão.
 */
export function ordemSemVolumeDosOutros<T extends { campo: string | null }>(u: QuemVe | null | undefined, ordem: T, campoDaContagem = "os"): T {
  return ordem.campo === campoDaContagem && soProprios(u, "ordens") ? { ...ordem, campo: null } : ordem;
}

/**
 * Junta o escopo a um `where` já montado sem mexer nos ORs dele (AND explícito). O tipo vem do ESCOPO (o `where`
 * ganha o tipo do Prisma como contexto e continua conferido).
 */
export function comEscopo<E extends object>(where: NoInfer<E>, escopo: E): E {
  return Object.keys(escopo).length ? ({ AND: [where, escopo] } as E) : where;
}
