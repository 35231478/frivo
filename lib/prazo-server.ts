import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { comEscopo } from "@/lib/escopo/proprios";
import { inicioHojeBR } from "@/lib/fuso";
import { whereOsAtrasada } from "@/lib/os/prazo-execucao";
import { contarAtendimento } from "@/lib/atendimento/prazo-server";

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
/** `escopoOs`: COM-1 — com "Ver só os próprios", só as OS do escopo da pessoa entram nas contagens. */
export async function contarAlertasPrazos(empresaId: string, escopoOs: Prisma.OrdemServicoWhereInput = {}) {
  await marcarPrazosVencidos(empresaId);

  const agora = new Date();
  const fimHoje = new Date(inicioHojeBR(agora, 1).getTime() - 1); // fim do dia em Brasília

  const [prazosVencidos, etapasVencendoHoje, pedidosPendentes, atendimentosAtraso, chamadosPortal, atendimento] = await Promise.all([
    prisma.osPrazo.count({ where: { ordemServico: comEscopo({ empresaId } as Prisma.OrdemServicoWhereInput, escopoOs), status: "ATRASADO" } }),
    prisma.osPrazoEtapa.count({
      where: {
        status: "EM_ANDAMENTO",
        prazoLimite: { gte: agora, lte: fimHoje },
        osPrazo: { ordemServico: comEscopo({ empresaId } as Prisma.OrdemServicoWhereInput, escopoOs), status: "ATIVO" },
      },
    }),
    prisma.pedidoCompraInterno.count({
      where: { empresaId, status: { in: ["SOLICITADO", "COTANDO", "COMPRADO", "PARCIAL"] } },
    }),
    // OS com o prazo de execução vencido — a regra única (lib/os/prazo-execucao.ts)
    prisma.ordemServico.count({ where: comEscopo({ empresaId, ...whereOsAtrasada(agora) } as Prisma.OrdemServicoWhereInput, escopoOs) }),
    prisma.ordemServico.count({
      where: comEscopo({ empresaId, origem: "PORTAL_CLIENTE", status: "AGUARDANDO_ATENDIMENTO" } as Prisma.OrdemServicoWhereInput, escopoOs),
    }),
    // PRAZO DE ATENDIMENTO do contrato (comparecer / resolver): vencendo e estourado — a regra única (lib/atendimento/prazo.ts)
    contarAtendimento(empresaId, agora, escopoOs),
  ]);

  return {
    prazosVencidos,
    etapasVencendoHoje,
    pedidosPendentes,
    atendimentosAtraso,
    chamadosPortal,
    atendimentoVencendo: atendimento.vencendo,
    atendimentoEstourado: atendimento.estourado,
    total: prazosVencidos + etapasVencendoHoje + pedidosPendentes + atendimentosAtraso + chamadosPortal + atendimento.vencendo + atendimento.estourado,
  };
}
