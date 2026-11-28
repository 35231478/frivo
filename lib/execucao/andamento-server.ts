/**
 * Atividade esquecida em andamento — lado do banco. As regras são as puras de lib/tecnico/andamento.ts.
 *  - o que o aparelho precisa para avisar sem sinal: o limite da empresa e a jornada (fim do expediente);
 *  - a ÚLTIMA GRAVAÇÃO da atividade (base do término sugerido quando o técnico esqueceu de concluir);
 *  - a contagem do sino do gestor (em andamento há mais do limite, ou desde outro dia).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jornadaDaEmpresa } from "@/lib/atendimento/prazo-server";
import { inicioHojeBR } from "@/lib/fuso";
import { limiteHoras, ultimaDe } from "@/lib/tecnico/andamento";
import type { AndamentoRetrato } from "@/lib/tecnico/offline/tipos";

/** O limite e a jornada da empresa (o mesmo para a lista do dia e para cada retrato). */
export async function andamentoDaEmpresa(empresaId: string): Promise<Omit<AndamentoRetrato, "ultimaGravacaoEm">> {
  const [config, jornada] = await Promise.all([
    prisma.configuracao.findUnique({ where: { empresaId }, select: { appAlertaAndamentoHoras: true } }),
    jornadaDaEmpresa(prisma, empresaId),
  ]);
  return { limiteHoras: limiteHoras(config?.appAlertaAndamentoHoras), jornada };
}

/** A última gravação da execução: resposta, foto, equipamento atendido, serviço extra, foto do serviço ou material. */
export async function ultimaGravacao(atividadeId: string): Promise<Date | null> {
  const maior = (r: { _max: Record<string, Date | null> }) => Object.values(r._max)[0] ?? null;
  const datas = await Promise.all([
    prisma.checklistResposta.aggregate({ where: { atividadeId }, _max: { respondidoEm: true } }).then(maior),
    prisma.fotoAtendimento.aggregate({ where: { atividadeId }, _max: { criadoEm: true } }).then(maior),
    prisma.atividadeEquipamento.aggregate({ where: { atividadeId }, _max: { feitoEm: true } }).then(maior),
    prisma.servicoAdicional.aggregate({ where: { atividadeId }, _max: { criadoEm: true } }).then(maior),
    prisma.osAnexo.aggregate({ where: { atividadeId }, _max: { criadoEm: true } }).then(maior),
    prisma.atividadeMaterial.aggregate({ where: { atividadeId, removidoEm: null }, _max: { atualizadoEm: true } }).then(maior),
  ]);
  return ultimaDe(datas);
}

export async function andamentoParaRetrato(empresaId: string, atividadeId: string): Promise<AndamentoRetrato> {
  const [base, ultima] = await Promise.all([andamentoDaEmpresa(empresaId), ultimaGravacao(atividadeId)]);
  return { ...base, ultimaGravacaoEm: ultima?.toISOString() ?? null };
}

/**
 * Sino do gestor: atividades EM ANDAMENTO há mais do limite da empresa, ou começadas antes de hoje (as antigas, sem
 * início gravado, pela hora agendada). Devolve a contagem e a OS da mais antiga (o link do aviso).
 */
/**
 * O filtro das atividades ESQUECIDAS em andamento (a mesma regra do sino e do push): passou do limite da empresa
 * ou começou antes de hoje (as antigas, sem início gravado, pela hora agendada).
 */
export async function whereAtividadesEsquecidas(empresaId: string, agora: Date = new Date()): Promise<Prisma.AtividadeOsWhereInput> {
  const { limiteHoras: horas } = await andamentoDaEmpresa(empresaId);
  // Antes deste instante = passou do limite; antes do começo de hoje = outro dia (o mais tarde dos dois vale)
  const corte = new Date(Math.max(agora.getTime() - horas * 3_600_000, inicioHojeBR(agora).getTime()));
  return {
    empresaId, status: "EM_ANDAMENTO",
    // D1: pausada não está "esquecida" (o relógio está parado; o impedimento tem aviso próprio)
    pausas: { none: { fim: null } },
    OR: [{ iniciadaEm: { lt: corte } }, { iniciadaEm: null, dataAgendada: { lt: corte } }],
  };
}

export async function contarAtividadesEsquecidas(empresaId: string, agora: Date = new Date()): Promise<{ atividadesEsquecidas: number; atividadeEsquecidaOsId: string | null }> {
  const where = await whereAtividadesEsquecidas(empresaId, agora);
  const [n, primeira] = await Promise.all([
    prisma.atividadeOs.count({ where }),
    prisma.atividadeOs.findFirst({ where, orderBy: [{ iniciadaEm: { sort: "asc", nulls: "first" } }, { dataAgendada: "asc" }], select: { ordemServicoId: true } }),
  ]);
  return { atividadesEsquecidas: n, atividadeEsquecidaOsId: primeira?.ordemServicoId ?? null };
}
