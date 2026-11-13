/**
 * DESEMPENHO — o ESTADO do fechamento de um mês (só leitura do banco). Fica separado para o painel, a
 * ficha e a revisão perguntarem "este mês está fechado?" sem depender do resto do fechamento.
 */
import { prisma } from "@/lib/prisma";
import { ErroDesempenho } from "./erros";
import { MSG_MES_FECHADO, lerPremios, type PainelCongelado, type PremioFechado } from "./fechamento";

export interface FechamentoVigente {
  id: string; versao: number; competencia: string; painel: PainelCongelado; premios: PremioFechado[]; total: number; fechadoEm: Date; fechadoPor: string;
}

/** O fechamento que está VALENDO para o mês (o "FECHADO"); null = mês aberto (nunca fechado ou reaberto). */
export async function fechamentoVigente(empresaId: string, competencia: string): Promise<FechamentoVigente | null> {
  const f = await prisma.desempenhoFechamento.findFirst({
    where: { empresaId, competencia, situacao: "FECHADO" }, orderBy: { versao: "desc" },
    select: { id: true, versao: true, competencia: true, painel: true, premios: true, totalBonus: true, fechadoEm: true, fechadoPorNome: true },
  });
  if (!f) return null;
  return {
    id: f.id, versao: f.versao, competencia: f.competencia, painel: f.painel as unknown as PainelCongelado, premios: lerPremios(f.premios),
    total: f.totalBonus.toNumber(), fechadoEm: f.fechadoEm, fechadoPor: f.fechadoPorNome,
  };
}

export const mesFechado = async (empresaId: string, competencia: string) =>
  (await prisma.desempenhoFechamento.count({ where: { empresaId, competencia, situacao: "FECHADO" } })) > 0;

/** Os meses fechados da empresa (para a detecção não criar item em mês que já fechou). */
export async function competenciasFechadas(empresaId: string): Promise<Set<string>> {
  const linhas = await prisma.desempenhoFechamento.findMany({ where: { empresaId, situacao: "FECHADO" }, select: { competencia: true } });
  return new Set(linhas.map((l) => l.competencia));
}

/** Mês fechado não muda: revisar, registrar, editar ou excluir penalidade dele pede reabrir antes. */
export async function exigirMesAberto(empresaId: string, competencia: string) {
  if (await mesFechado(empresaId, competencia)) throw new ErroDesempenho(MSG_MES_FECHADO(competencia), 409);
}
