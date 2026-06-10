import { prisma } from "@/lib/prisma";

/**
 * Conta os alertas relacionados à frota de veículos para o sino e o dashboard:
 * - checklistPendente: veículos ativos sem checklist preenchido hoje (se houver template ativo)
 * - checklistsComAlertas: checklists preenchidos hoje com itens em alerta (notifica o gestor)
 * - documentosVencendo: veículos com documento/seguro vencendo em até 30 dias (ou vencido)
 * - veiculosManutencao: veículos com status MANUTENCAO
 * - revisaoChegando: veículos com próxima revisão em até 30 dias
 */
export async function contarAlertasVeiculos(empresaId: string) {
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
  const em30 = new Date(agora.getTime() + 30 * 864e5);

  const [templatesAtivos, veiculosAtivos, checklistsHoje, checklistsComAlertas, veiculosManutencao, docsVencendo, seguroVencendo, revisaoChegando] =
    await Promise.all([
      prisma.checklistTemplate.count({ where: { empresaId, ativo: true } }),
      prisma.veiculo.findMany({ where: { empresaId, status: { not: "INATIVO" } }, select: { id: true } }),
      prisma.checklistPreenchido.findMany({ where: { empresaId, criadoEm: { gte: inicioHoje } }, select: { veiculoId: true }, distinct: ["veiculoId"] }),
      prisma.checklistPreenchido.count({ where: { empresaId, status: "COM_ALERTAS", criadoEm: { gte: inicioHoje } } }),
      prisma.veiculo.count({ where: { empresaId, status: "MANUTENCAO" } }),
      prisma.veiculo.findMany({ where: { empresaId, documentos: { some: { dataVencimento: { lte: em30 } } } }, select: { id: true } }),
      prisma.veiculo.findMany({ where: { empresaId, seguroVencimento: { lte: em30 } }, select: { id: true } }),
      prisma.veiculo.count({ where: { empresaId, proximaRevisaoData: { gte: inicioHoje, lte: em30 } } }),
    ]);

  const idsComChecklist = new Set(checklistsHoje.map((c) => c.veiculoId));
  const checklistPendente = templatesAtivos > 0 ? veiculosAtivos.filter((v) => !idsComChecklist.has(v.id)).length : 0;

  const idsDocVencendo = new Set([...docsVencendo.map((v) => v.id), ...seguroVencendo.map((v) => v.id)]);
  const documentosVencendo = idsDocVencendo.size;

  return {
    checklistPendente,
    checklistsComAlertas,
    documentosVencendo,
    veiculosManutencao,
    revisaoChegando,
  };
}
