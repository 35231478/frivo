import { prisma } from "@/lib/prisma";
import { osJaFaturada } from "@/lib/faturamento-os";
import { motivoDaTrava, situacaoDaOs, type SituacaoDoRegistro } from "@/lib/edicao-contexto";

/** Nota que conta como emitida (ou a caminho): rejeitada, cancelada e interrompida não travam nada. */
const NOTA_VIVA = { notIn: ["REJEITADO", "CANCELADO", "INTERROMPIDO"] };

/**
 * A situação da OS para a trava de registro fechado, lida do banco (a tela não decide sozinha):
 * status, aceite do cliente, se já entrou numa fatura/medição viva e se há nota fiscal emitida.
 */
export async function situacaoDaOsNoBanco(osId: string): Promise<SituacaoDoRegistro> {
  const [os, fatura] = await Promise.all([
    prisma.ordemServico.findUnique({ where: { id: osId }, select: { status: true, aceite: { select: { situacao: true } } } }),
    osJaFaturada(osId),
  ]);
  const notaEmitida = (await prisma.notaFiscal.count({
    where: { status: NOTA_VIVA, OR: [{ ordemServicoId: osId }, ...(fatura ? [{ medicaoId: fatura.id }] : [])] },
  })) > 0;
  return situacaoDaOs({ status: os?.status, aceite: os?.aceite, faturada: !!fatura, notaEmitida });
}

/** Por que as linhas desta OS estão travadas (registro fechado) — ou null. */
export async function travaDasLinhasDaOs(osId: string): Promise<string | null> {
  return motivoDaTrava(await situacaoDaOsNoBanco(osId));
}
