import { prisma } from "@/lib/prisma";

/**
 * Marca de forma preguiçosa as etapas e prazos vencidos como ATRASADA/ATRASADO.
 * Deve ser chamado no carregamento das páginas que exibem prazos.
 */
export async function marcarPrazosVencidos(empresaId: string) {
  const agora = new Date();

  await prisma.osPrazoEtapa.updateMany({
    where: {
      status: "EM_ANDAMENTO",
      prazoLimite: { lt: agora },
      osPrazo: { ordemServico: { empresaId } },
    },
    data: { status: "ATRASADA" },
  });

  await prisma.osPrazo.updateMany({
    where: {
      status: "ATIVO",
      ordemServico: { empresaId },
      etapas: { some: { status: "ATRASADA" } },
    },
    data: { status: "ATRASADO" },
  });
}

/** Conta os alertas de prazos para o dashboard e o sino do header. */
export async function contarAlertasPrazos(empresaId: string) {
  await marcarPrazosVencidos(empresaId);

  const agora = new Date();
  const fimHoje = new Date(agora);
  fimHoje.setHours(23, 59, 59, 999);

  const [prazosVencidos, etapasVencendoHoje, pedidosPendentes, atendimentosAtraso, chamadosPortal] = await Promise.all([
    prisma.osPrazo.count({ where: { ordemServico: { empresaId }, status: "ATRASADO" } }),
    prisma.osPrazoEtapa.count({
      where: {
        status: "EM_ANDAMENTO",
        prazoLimite: { gte: agora, lte: fimHoje },
        osPrazo: { ordemServico: { empresaId }, status: "ATIVO" },
      },
    }),
    prisma.pedidoCompraInterno.count({
      where: { empresaId, status: { in: ["SOLICITADO", "COTANDO", "COMPRADO"] } },
    }),
    prisma.ordemServico.count({
      where: {
        empresaId,
        status: { notIn: ["CONCLUIDA", "CANCELADA"] },
        previsaoConclusao: { lt: agora },
      },
    }),
    prisma.ordemServico.count({
      where: { empresaId, origem: "PORTAL_CLIENTE", status: "AGUARDANDO_ATENDIMENTO" },
    }),
  ]);

  return {
    prazosVencidos,
    etapasVencendoHoje,
    pedidosPendentes,
    atendimentosAtraso,
    chamadosPortal,
    total: prazosVencidos + etapasVencendoHoje + pedidosPendentes + atendimentosAtraso + chamadosPortal,
  };
}
