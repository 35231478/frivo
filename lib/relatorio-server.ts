import { prisma } from "@/lib/prisma";
import { gerarNumeroRelatorio } from "@/lib/utils";

/** Resumo automático de uma atividade: descrição/observação ou 1ª resposta do questionário. */
function resumoAtividade(a: { observacao?: string | null; resumo?: string | null; respostas: { resposta: string | null; campo: { label: string } }[] }): string {
  const base = (a.observacao || a.resumo || "").trim();
  if (base) return base.slice(0, 150);
  const primeira = a.respostas.find((r) => (r.resposta ?? "").trim());
  if (primeira) return `${primeira.campo.label}: ${primeira.resposta}`.slice(0, 150);
  return "";
}

/**
 * Gera, de forma idempotente, os relatórios de uma OS:
 * - um relatório ATIVIDADE por atividade concluída (sem relatório ainda);
 * - um relatório GERAL consolidando a OS (se ainda não existir).
 * Chamado automaticamente quando a OS é concluída.
 */
export async function gerarRelatoriosDaOs(osId: string, empresaId: string) {
  const os = await prisma.ordemServico.findFirst({
    where: { id: osId, empresaId },
    include: {
      atividades: {
        orderBy: { criadoEm: "asc" },
        include: { respostas: { include: { campo: { select: { label: true } } } } },
      },
      relatorios: { select: { id: true, escopo: true, atividadeId: true } },
    },
  });
  if (!os) return { criados: 0 };

  const ref = os.dataConclusao ?? new Date();
  const mesReferencia = ref.getMonth() + 1;
  const anoReferencia = ref.getFullYear();

  let seq = await prisma.relatorioOs.count({ where: { empresaId } });
  let criados = 0;

  // Relatórios individuais por atividade concluída
  const atividadesConcluidas = os.atividades.filter((a) => a.status === "CONCLUIDA");
  for (const a of atividadesConcluidas) {
    const jaTem = os.relatorios.some((r) => r.escopo === "ATIVIDADE" && r.atividadeId === a.id);
    if (jaTem) continue;
    seq++;
    await prisma.relatorioOs.create({
      data: {
        empresaId,
        ordemServicoId: os.id,
        atividadeId: a.id,
        contratoId: os.contratoId,
        numero: gerarNumeroRelatorio(seq, anoReferencia),
        tipo: "MANUTENCAO",
        escopo: "ATIVIDADE",
        resumoAutomatico: resumoAtividade(a),
        mesReferencia,
        anoReferencia,
        status: "RASCUNHO",
        tokenPublico: crypto.randomUUID(),
      },
    });
    criados++;
  }

  // Relatório geral consolidado
  const temGeral = os.relatorios.some((r) => r.escopo === "GERAL");
  if (!temGeral) {
    seq++;
    const resumoGeral = `${os.atividades.length} atividade(s) · ${atividadesConcluidas.length} concluída(s)`;
    await prisma.relatorioOs.create({
      data: {
        empresaId,
        ordemServicoId: os.id,
        contratoId: os.contratoId,
        numero: gerarNumeroRelatorio(seq, anoReferencia),
        tipo: "PMOC",
        escopo: "GERAL",
        resumoAutomatico: resumoGeral,
        mesReferencia,
        anoReferencia,
        status: "RASCUNHO",
        tokenPublico: crypto.randomUUID(),
      },
    });
    criados++;
  }

  return { criados };
}

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

/** Carrega os dados de uma atividade para o relatório individual (pela atividade id). */
export async function carregarAtividade(atividadeId: string) {
  const atividade = await prisma.atividadeOs.findUnique({
    where: { id: atividadeId },
    include: {
      tecnico: { select: { nome: true } },
      tipoOs: { select: { nome: true, cor: true } },
      respostas: { include: { campo: { select: { label: true, tipo: true } } } },
      ordemServico: {
        include: {
          empresa: true,
          cliente: true,
          unidade: { select: { id: true, nome: true } },
          contrato: {
            select: { numero: true, artNumero: true, responsavelTecnico: { select: { nome: true, crea: true } } },
          },
        },
      },
    },
  });
  if (!atividade) return null;

  const os = atividade.ordemServico;
  const equipamentos = os.unidadeId
    ? await prisma.equipamento.findMany({
        where: { unidadeId: os.unidadeId, ativo: true },
        select: { id: true, tipo: true, marca: true, modelo: true, numeroSerie: true, localizacao: true },
      })
    : [];

  const rel = await prisma.relatorioOs.findFirst({
    where: { atividadeId, escopo: "ATIVIDADE" },
    select: { numero: true },
  });

  return { empresa: os.empresa, os, atividade, equipamentos, numero: rel?.numero ?? "RELATÓRIO" };
}
