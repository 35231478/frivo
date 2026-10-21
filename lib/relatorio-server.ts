import { prisma } from "@/lib/prisma";

/** Campos do equipamento no relatório da OS (ambiente/setor separados do tipo + capacidade). */
const SELECT_EQUIP_RELATORIO = {
  id: true, tipo: true, marca: true, modelo: true, numeroSerie: true, localizacao: true,
  setor: true, capacidade: true, patrimonio: true, nome: true, tipoEquipamento: { select: { nome: true } },
} as const;
import { gerarNumeroRelatorio } from "@/lib/utils";
import { adicionaisDe, blocosAtendidos, SELECT_ADICIONAIS, SELECT_CHECKLIST, SELECT_FOTOS } from "@/lib/relatorio-os/dados";
import { tokenRelatorioNoFormato } from "@/lib/relatorio-atividade-link";

/** O que o relatório precisa para montar os blocos dos equipamentos ATENDIDOS (checklist, fotos, observação). */
const INCLUDE_ATENDIMENTO = {
  equipamentos: { orderBy: { criadoEm: "asc" }, include: { equipamento: { select: SELECT_EQUIP_RELATORIO } } },
  respostasEquipamento: { include: { campo: { select: { label: true, tipo: true, ordem: true } }, formulario: { select: { nome: true } } } },
  checklistRespostas: SELECT_CHECKLIST,
  fotosAtendimento: SELECT_FOTOS,
  servicosAdicionais: SELECT_ADICIONAIS,
} as const;

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

  // Sequencial derivado do maior número de relatório do ano de referência (evita colisão entre anos)
  const ultimoRel = await prisma.relatorioOs.findFirst({
    where: { empresaId, numero: { startsWith: `REL-${anoReferencia}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  let seq = ultimoRel ? Number(ultimoRel.numero.split("-")[2]) : 0;
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
          equipamento: { select: SELECT_EQUIP_RELATORIO },
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
              equipe: { select: { nome: true } },
              tecnicosEquipe: { select: { tecnico: { select: { nome: true } } }, orderBy: { criadoEm: "asc" } },
              tipoOs: { select: { nome: true } },
              respostas: { include: { campo: { select: { label: true, tipo: true } } } },
              ...INCLUDE_ATENDIMENTO,
            },
          },
        },
      },
    },
  });

  if (!relatorio) return null;

  // SÓ os equipamentos atendidos (na atividade do relatório, ou na OS toda), nunca todos os da unidade
  const os = relatorio.ordemServico;
  const daAtividade = relatorio.escopo === "ATIVIDADE" && !!relatorio.atividadeId;
  const ativs = daAtividade ? os.atividades.filter((a) => a.id === relatorio.atividadeId) : os.atividades;
  const { blocos, equipamentosAtendidos: equipamentos } = blocosAtendidos(ativs, os.unidade?.nome ?? null, daAtividade ? null : os.equipamento, os.status === "CONCLUIDA");

  return { relatorio, empresa: relatorio.empresa, os, equipamentos, blocos, adicionais: adicionaisDe(ativs) };
}

/**
 * Relatório PÚBLICO de uma atividade (/relatorio/atividade/<id>?t=<token>). Procura SÓ pelo token
 * (o segredo) e depois confere o id: sem token, token errado e id inexistente dão o mesmo `null`
 * (→ a mesma 404), e o trabalho no banco não depende do id — trocar o id não revela nada.
 */
export async function carregarAtividade(atividadeId: string, token: unknown) {
  if (!tokenRelatorioNoFormato(token)) return null;
  const atividade = await prisma.atividadeOs.findUnique({
    where: { tokenRelatorio: token },
    include: {
      tecnico: { select: { nome: true } },
      equipe: { select: { nome: true } },
      tecnicosEquipe: { select: { tecnico: { select: { nome: true } } }, orderBy: { criadoEm: "asc" } },
      tipoOs: { select: { nome: true, cor: true } },
      respostas: { include: { campo: { select: { label: true, tipo: true } } } },
      ...INCLUDE_ATENDIMENTO,
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
  if (!atividade || atividade.id !== atividadeId) return null;

  const os = atividade.ordemServico;
  // SÓ os equipamentos atendidos nesta atividade, cada um com o checklist, as fotos e a observação dele
  const { blocos: equipamentos } = blocosAtendidos([atividade], os.unidade?.nome ?? null);
  const adicionais = adicionaisDe([atividade]);

  const rel = await prisma.relatorioOs.findFirst({
    where: { atividadeId, escopo: "ATIVIDADE" },
    select: { numero: true },
  });

  return { empresa: os.empresa, os, atividade, equipamentos, adicionais, numero: rel?.numero ?? "RELATÓRIO" };
}
