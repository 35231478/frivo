import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sugerirVeiculo } from "@/lib/veiculo-sugestao";

/**
 * Vários técnicos na mesma atividade da OS (escolhidos um a um ou a partir de uma EQUIPE).
 * - `atividades_os.tecnico_id` continua sendo o RESPONSÁVEL (o líder da equipe, se estiver
 *   na lista; senão o 1º escolhido) — a OS segue ligada a técnico como sempre;
 * - os demais ficam em `atividade_tecnicos`;
 * - `atividades_os.equipe_id` registra a equipe usada (só registro; a composição real é a lista).
 * Execução/conclusão continua regida pelas permissões (ordens.editar / ordens.concluir):
 * qualquer membro com essa permissão pode executar.
 *
 * Quem executa é OBRIGATÓRIO ao criar/salvar a atividade (equipe OU colaboradores).
 * Atividades antigas sem executor continuam abrindo e mudando de status normalmente;
 * só ao salvar a edição é que o executor passa a ser exigido.
 */

export class ErroTecnicos extends Error {}

export const MSG_SEM_EXECUTOR = "Escolha quem executa: uma equipe ou um ou mais colaboradores.";

/** Include padrão para exibir os técnicos de uma atividade (responsável + equipe). */
export const INCLUDE_TECNICOS_ATIVIDADE = {
  tecnico: { select: { id: true, nome: true } },
  equipe: { select: { id: true, nome: true, cor: true } },
  tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "asc" } },
  veiculo: { select: { id: true, placa: true, modelo: true, marca: true } },
} satisfies Prisma.AtividadeOsInclude;

export interface DefinicaoTecnicos {
  /** Todos os técnicos da atividade (com ou sem o responsável). */
  tecnicoIds: string[];
  /** Responsável; se omitido, o líder da equipe (se estiver na lista) ou o 1º. */
  responsavelId?: string | null;
  equipeId?: string | null;
}

/** Quem já está na atividade (edição): continua aceito mesmo se foi inativado depois. */
export interface VinculosAtuais {
  tecnicoIds: string[];
  equipeId: string | null;
}

/**
 * Valida e normaliza: técnicos ativos da empresa, com competência no tipo de OS (quando
 * houver — mesma regra do seletor de técnico) e equipe ativa da empresa.
 * Na edição, `vinculosAtuais` lista quem JÁ está na atividade: esses continuam aceitos mesmo
 * inativos (reeditar uma atividade antiga não pode travar). Inativo só é recusado como vínculo NOVO.
 */
export async function resolverTecnicos(
  empresaId: string, def: DefinicaoTecnicos, tipoOsId: string | null,
  opts: { exigir?: boolean; vinculosAtuais?: VinculosAtuais } = {},
) {
  const ids = [...new Set(def.tecnicoIds.filter(Boolean))].slice(0, 30);
  if (opts.exigir && !ids.length) {
    throw new ErroTecnicos(def.equipeId
      ? "A equipe escolhida não tem colaboradores aptos (ativos e com competência neste tipo de OS). Adicione colaboradores."
      : MSG_SEM_EXECUTOR);
  }
  let equipe: { id: string; liderId: string | null } | null = null;
  const atuais = opts.vinculosAtuais;
  if (def.equipeId) {
    const equipeJaVinculada = !!atuais?.equipeId && atuais.equipeId === def.equipeId;
    equipe = await prisma.equipe.findFirst({
      where: { id: def.equipeId, empresaId, ...(equipeJaVinculada ? {} : { status: "ATIVA" as const }) },
      select: { id: true, liderId: true },
    });
    if (!equipe) throw new ErroTecnicos("Equipe inválida ou inativa.");
  }
  if (ids.length) {
    const jaVinculados = new Set(atuais?.tecnicoIds ?? []);
    const encontrados = await prisma.tecnico.findMany({
      where: { id: { in: ids }, empresaId },
      select: { id: true, nome: true, ativo: true, competencias: tipoOsId ? { where: { id: tipoOsId }, select: { id: true } } : undefined },
    });
    const validos = encontrados.filter((t) => t.ativo || jaVinculados.has(t.id));
    if (validos.length !== ids.length) throw new ErroTecnicos("Um ou mais técnicos são inválidos ou estão inativos.");
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

/**
 * Lê `tecnicoIds`/`responsavelId`/`equipeId` do corpo da requisição (undefined = não mexer).
 * O formato antigo (só `tecnicoId`) vira uma definição de 1 técnico — passa pelas mesmas validações.
 */
export function lerDefinicao(body: any): DefinicaoTecnicos | undefined {
  if (body && !Array.isArray(body.tecnicoIds) && typeof body.tecnicoId === "string") {
    return { tecnicoIds: body.tecnicoId ? [body.tecnicoId] : [], responsavelId: body.tecnicoId || null, equipeId: null };
  }
  if (!body || !Array.isArray(body.tecnicoIds)) return undefined;
  return {
    tecnicoIds: body.tecnicoIds.filter((x: unknown): x is string => typeof x === "string"),
    responsavelId: typeof body.responsavelId === "string" ? body.responsavelId : null,
    equipeId: typeof body.equipeId === "string" && body.equipeId ? body.equipeId : null,
  };
}

/** `veiculoId` do corpo: undefined = não informado; null = sem veículo; string = escolhido. */
export function lerVeiculo(body: any): string | null | undefined {
  if (!body || !("veiculoId" in body) || body.veiculoId === undefined) return undefined;
  return typeof body.veiculoId === "string" && body.veiculoId ? body.veiculoId : null;
}

/**
 * Veículo da atividade. Escolhido → valida que é da empresa. Não informado → puxa o padrão
 * (equipe → veículo da equipe; colaborador → veículo padrão do responsável), como a tela faz.
 */
export async function resolverVeiculo(
  empresaId: string, pedido: string | null | undefined, r: { responsavel: string | null; equipeId: string | null },
): Promise<string | null> {
  if (pedido) {
    const v = await prisma.veiculo.findFirst({ where: { id: pedido, empresaId }, select: { id: true } });
    if (!v) throw new ErroTecnicos("Veículo inválido.");
    return v.id;
  }
  if (pedido === null) return null;
  const [veiculos, resp] = await Promise.all([
    prisma.veiculo.findMany({
      where: { empresaId, status: "ATIVO", OR: [{ equipeId: r.equipeId ?? "__nenhuma__" }, { colaboradoresPadrao: { some: { id: r.responsavel ?? "__nenhum__" } } }] },
      select: { id: true, placa: true, modelo: true, marca: true, status: true, equipeId: true },
    }),
    r.responsavel ? prisma.tecnico.findUnique({ where: { id: r.responsavel }, select: { veiculoId: true } }) : null,
  ]);
  return sugerirVeiculo({ equipeId: r.equipeId, responsavelId: r.responsavel }, veiculos, () => resp?.veiculoId).veiculoId;
}
