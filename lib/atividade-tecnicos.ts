import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Vários técnicos na mesma atividade da OS (escolhidos um a um ou a partir de uma EQUIPE).
 * - `atividades_os.tecnico_id` continua sendo o RESPONSÁVEL (o líder da equipe, se estiver
 *   na lista; senão o 1º escolhido) — a OS segue ligada a técnico como sempre;
 * - os demais ficam em `atividade_tecnicos`;
 * - `atividades_os.equipe_id` registra a equipe usada (só registro; a composição real é a lista).
 * Execução/conclusão continua regida pelas permissões (ordens.editar / ordens.concluir):
 * qualquer membro com essa permissão pode executar.
 */

export class ErroTecnicos extends Error {}

/** Include padrão para exibir os técnicos de uma atividade (responsável + equipe). */
export const INCLUDE_TECNICOS_ATIVIDADE = {
  tecnico: { select: { id: true, nome: true } },
  equipe: { select: { id: true, nome: true, cor: true } },
  tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "asc" } },
} satisfies Prisma.AtividadeOsInclude;

export interface DefinicaoTecnicos {
  /** Todos os técnicos da atividade (com ou sem o responsável). */
  tecnicoIds: string[];
  /** Responsável; se omitido, o líder da equipe (se estiver na lista) ou o 1º. */
  responsavelId?: string | null;
  equipeId?: string | null;
}

/**
 * Valida e normaliza: técnicos ativos da empresa, com competência no tipo de OS (quando
 * houver — mesma regra do seletor de técnico) e equipe ativa da empresa.
 */
export async function resolverTecnicos(empresaId: string, def: DefinicaoTecnicos, tipoOsId: string | null) {
  const ids = [...new Set(def.tecnicoIds.filter(Boolean))].slice(0, 30);
  let equipe: { id: string; liderId: string | null } | null = null;
  if (def.equipeId) {
    equipe = await prisma.equipe.findFirst({ where: { id: def.equipeId, empresaId, status: "ATIVA" }, select: { id: true, liderId: true } });
    if (!equipe) throw new ErroTecnicos("Equipe inválida ou inativa.");
  }
  if (ids.length) {
    const encontrados = await prisma.tecnico.findMany({
      where: { id: { in: ids }, empresaId, ativo: true },
      select: { id: true, nome: true, competencias: tipoOsId ? { where: { id: tipoOsId }, select: { id: true } } : undefined },
    });
    if (encontrados.length !== ids.length) throw new ErroTecnicos("Um ou mais técnicos são inválidos ou estão inativos.");
    if (tipoOsId) {
      const sem = encontrados.filter((t) => !(t.competencias ?? []).length).map((t) => t.nome);
      if (sem.length) throw new ErroTecnicos(`Sem competência neste tipo de OS: ${sem.join(", ")}.`);
    }
  }
  const pedido = def.responsavelId && ids.includes(def.responsavelId) ? def.responsavelId : null;
  const lider = equipe?.liderId && ids.includes(equipe.liderId) ? equipe.liderId : null;
  const responsavel = pedido ?? lider ?? ids[0] ?? null;
  return { responsavel, outros: ids.filter((i) => i !== responsavel), equipeId: equipe?.id ?? null };
}

/** Grava a composição (substitui a lista anterior de técnicos adicionais). */
export async function gravarTecnicos(
  tx: Prisma.TransactionClient, atividadeId: string, r: { responsavel: string | null; outros: string[]; equipeId: string | null },
) {
  await tx.atividadeOs.update({ where: { id: atividadeId }, data: { tecnicoId: r.responsavel, equipeId: r.equipeId } });
  await tx.atividadeTecnico.deleteMany({ where: { atividadeId } });
  if (r.outros.length) await tx.atividadeTecnico.createMany({ data: r.outros.map((tecnicoId) => ({ atividadeId, tecnicoId })) });
}

/** Lê `tecnicoIds`/`responsavelId`/`equipeId` do corpo da requisição (undefined = não mexer). */
export function lerDefinicao(body: any): DefinicaoTecnicos | undefined {
  if (!body || !Array.isArray(body.tecnicoIds)) return undefined;
  return {
    tecnicoIds: body.tecnicoIds.filter((x: unknown): x is string => typeof x === "string"),
    responsavelId: typeof body.responsavelId === "string" ? body.responsavelId : null,
    equipeId: typeof body.equipeId === "string" && body.equipeId ? body.equipeId : null,
  };
}
