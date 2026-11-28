import { prisma } from "@/lib/prisma";
import { contarNaoVaiUsar } from "@/lib/checklist-diario/servidor";
import { hojeDiaCivil, inicioHojeBR } from "@/lib/fuso";

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
  const inicioHoje = inicioHojeBR(agora); // checklist de hoje (instante) — dia de Brasília
  const hojeCivil = hojeDiaCivil(agora); // vencimentos/revisão são dias civis
  const em30 = hojeDiaCivil(agora, 30);

  const [templatesAtivos, veiculosAtivos, checklistsHoje, [checklistsComAlertas, checklistAlerta], veiculosManutencao, docsVencendo, seguroVencendo, revisaoChegando] =
    await Promise.all([
      prisma.checklistTemplate.count({ where: { empresaId, ativo: true } }),
      prisma.veiculo.findMany({ where: { empresaId, status: { not: "INATIVO" } }, select: { id: true } }),
      prisma.checklistPreenchido.findMany({ where: { empresaId, criadoEm: { gte: inicioHoje }, inativadoEm: null }, select: { veiculoId: true }, distinct: ["veiculoId"] }),
      // A contagem e o mais recente (o sino leva direto à ficha do veículo quando é um só)
      Promise.all([
        prisma.checklistPreenchido.count({ where: { empresaId, status: "COM_ALERTAS", criadoEm: { gte: inicioHoje }, inativadoEm: null } }),
        prisma.checklistPreenchido.findFirst({ where: { empresaId, status: "COM_ALERTAS", criadoEm: { gte: inicioHoje }, inativadoEm: null }, orderBy: { criadoEm: "desc" }, select: { id: true, veiculoId: true } }),
      ]),
      prisma.veiculo.count({ where: { empresaId, status: "MANUTENCAO" } }),
      prisma.veiculo.findMany({ where: { empresaId, documentos: { some: { dataVencimento: { lte: em30 } } } }, select: { id: true } }),
      prisma.veiculo.findMany({ where: { empresaId, seguroVencimento: { lte: em30 } }, select: { id: true } }),
      prisma.veiculo.count({ where: { empresaId, proximaRevisaoData: { gte: hojeCivil, lte: em30 } } }),
    ]);

  const idsComChecklist = new Set(checklistsHoje.map((c) => c.veiculoId));
  const checklistPendente = templatesAtivos > 0 ? veiculosAtivos.filter((v) => !idsComChecklist.has(v.id)).length : 0;

  const idsDocVencendo = new Set([...docsVencendo.map((v) => v.id), ...seguroVencendo.map((v) => v.id)]);
  const documentosVencendo = idsDocVencendo.size;
  // O veículo quando é um só (o sino abre a ficha dele, na aba Documentos)
  const documentoVencendoVeiculoId = documentosVencendo === 1 ? [...idsDocVencendo][0] : null;

  return {
    checklistPendente,
    checklistsComAlertas,
    /** Leva I.2: o checklist com alertas mais recente de hoje e o veículo dele (o sino abre a ficha do veículo) */
    checklistAlertaId: checklistAlerta?.id ?? null,
    checklistAlertaVeiculoId: checklistAlerta?.veiculoId ?? null,
    // Checklist obrigatório no app: colaborador marcou "Hoje não vou usar o veículo" e ninguém do escritório viu
    checklistNaoVaiUsar: await contarNaoVaiUsar(empresaId, agora),
    documentosVencendo,
    documentoVencendoVeiculoId,
    veiculosManutencao,
    revisaoChegando,
  };
}
