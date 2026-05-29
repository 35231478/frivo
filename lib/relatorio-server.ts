import { prisma } from "@/lib/prisma";

/** Carrega um relatório pelo token público com todos os dados para o documento. */
export async function carregarRelatorioPorToken(token: string) {
  const relatorio = await prisma.relatorioOs.findUnique({
    where: { tokenPublico: token },
    include: {
      empresa: true,
      ordemServico: {
        include: {
          cliente: true,
          unidade: { select: { id: true, nome: true } },
          contrato: {
            select: {
              numero: true, artNumero: true,
              responsavelTecnico: { select: { nome: true, crea: true } },
            },
          },
          atividades: {
            orderBy: { criadoEm: "asc" },
            include: {
              tecnico: { select: { nome: true } },
              tipoOs: { select: { nome: true } },
              respostas: { include: { campo: { select: { label: true, tipo: true } } } },
            },
          },
        },
      },
    },
  });

  if (!relatorio) return null;

  const equipamentos = relatorio.ordemServico.unidadeId
    ? await prisma.equipamento.findMany({
        where: { unidadeId: relatorio.ordemServico.unidadeId, ativo: true },
        select: { id: true, tipo: true, marca: true, modelo: true, numeroSerie: true, localizacao: true },
      })
    : [];

  return { relatorio, empresa: relatorio.empresa, os: relatorio.ordemServico, equipamentos };
}
