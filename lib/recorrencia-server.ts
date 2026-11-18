import { prisma } from "@/lib/prisma";
import { contratoGeraFinanceiro } from "@/lib/financeiro-server";
import { proximasOcorrencias } from "@/lib/recorrencia-helpers";
import { diaDoMesCivil } from "@/lib/fuso";
import { comNumero } from "@/lib/numeracao-server";
import { prazoPadrao } from "@/lib/os/prazo-execucao";

/** De onde veio a geração: ao salvar o contrato (a pessoa) ou a rotina diária (o horizonte rolante) */
type Origem = "contrato" | "rotina";
const COMO: Record<Origem, string> = { contrato: "ao salvar o contrato", rotina: "pela rotina diária do contrato" };

class JaExiste extends Error {}
type Tx = Parameters<Parameters<typeof comNumero>[2]>[1];

/**
 * Cria a OS só se a ocorrência ainda não existe — conferindo DENTRO da transação do número, sob a
 * trava do contador da empresa. Duas gerações ao mesmo tempo (a rotina e alguém salvando o contrato)
 * entram em fila: a segunda já enxerga a OS da primeira e não cria outra. null = já existia.
 */
async function criarSeFalta<T>(empresaId: string, onde: Record<string, unknown>, criar: (numero: string, tx: Tx) => Promise<T>): Promise<T | null> {
  try {
    return await comNumero(empresaId, "os", async (numero, tx) => {
      if (await tx.ordemServico.findFirst({ where: onde, select: { id: true } })) throw new JaExiste();
      return criar(numero, tx);
    });
  } catch (e) {
    if (e instanceof JaExiste) return null; // a transação desfez a reserva: nenhum número queimado
    throw e;
  }
}

/**
 * Gera (idempotente) as OS recorrentes futuras de um contrato, a partir de hoje,
 * dentro da vigência e limitadas a `limite` ocorrências. Cada OS é criada com
 * status AGENDADA, origem RECORRENTE e vinculada ao contrato/cliente — aparecendo
 * no calendário e na listagem de OS. Não duplica períodos já gerados.
 * Retorna a quantidade de OS criadas.
 */
export async function gerarOsRecorrentesContrato(
  contratoId: string,
  usuarioId: string,
  limite = 12,
  origem: Origem = "contrato",
): Promise<number> {
  const ct = await prisma.contrato.findUnique({
    where: { id: contratoId },
    include: { tipoOsRecorrencia: { select: { id: true, nome: true, prazoExecucaoDias: true } } },
  });
  if (!ct) return 0;
  if (!ct.recorrencia || !ct.frequenciaRecorrencia) return 0;
  if (!contratoGeraFinanceiro(ct.status)) return 0; // CO2: só ATIVO gera OS

  const ocorrencias = proximasOcorrencias({
    dataInicio: ct.dataInicio,
    dataFim: ct.dataFim,
    frequencia: ct.frequenciaRecorrencia,
    diaRecorrencia: ct.diaRecorrencia,
    fimSemana: ct.fimSemanaRecorrencia,
    limite,
  });
  if (ocorrencias.length === 0) return 0;

  const tituloTipo = ct.tipoOsRecorrencia?.nome ?? "Atendimento recorrente";

  // Uma consulta só para o que já existe (a rotina diária passa por todos os contratos)
  const daOcorrencia = { empresaId: ct.empresaId, contratoId: ct.id, unidadeId: null };
  const existentes = new Set((await prisma.ordemServico.findMany({
    where: { ...daOcorrencia, periodoRecorrencia: { in: ocorrencias.map((o) => o.periodo) } },
    select: { periodoRecorrencia: true },
  })).map((o) => o.periodoRecorrencia));

  let criadas = 0;
  for (const oc of ocorrencias) {
    if (existentes.has(oc.periodo)) continue;

    // Número pelo contador da empresa (rótulo = ano da ocorrência), sob trava, na transação do INSERT
    const os = await criarSeFalta(ct.empresaId, { ...daOcorrencia, periodoRecorrencia: oc.periodo }, (numero, tx) => tx.ordemServico.create({
      data: {
        empresaId: ct.empresaId,
        numero,
        clienteId: ct.clienteId,
        contratoId: ct.id,
        criadoPorId: usuarioId,
        status: "AGENDADA",
        origem: "RECORRENTE",
        periodoRecorrencia: oc.periodo,
        prioridade: "NORMAL",
        descricao: `${tituloTipo} — contrato ${ct.numero} (${String(oc.mes).padStart(2, "0")}/${oc.ano})`,
        // a data prevista é a do agendamento; o prazo, só quando o tipo de OS tem um padrão
        previsaoConclusao: oc.data,
        prazoExecucao: prazoPadrao(oc.data, ct.tipoOsRecorrencia?.prazoExecucaoDias),
        atividades: (ct.tipoOsRecorrenciaId || ct.tecnicoRecorrenciaId)
          ? {
              create: {
                empresaId: ct.empresaId,
                tipoOsId: ct.tipoOsRecorrenciaId || null,
                tecnicoId: ct.tecnicoRecorrenciaId || null,
                titulo: tituloTipo,
                status: "AGENDADA",
                dataAgendada: oc.data,
              },
            }
          : undefined,
      },
    }));
    if (!os) continue; // outra geração criou esta ocorrência no mesmo instante

    await prisma.osHistorico.create({
      data: {
        ordemServicoId: os.id,
        usuarioId,
        acao: "OS recorrente gerada",
        detalhes: `Gerada automaticamente ${COMO[origem]} ${ct.numero} (${oc.periodo}).`,
      },
    });

    criadas++;
  }

  return criadas;
}

/**
 * Gera (idempotente) as OS recorrentes por LOCAL coberto do contrato. Cada local
 * com recorrência ativa tem sua própria frequência/tipo/responsável/data inicial.
 * As OS criadas levam o unidadeId (endereço), status AGENDADA e origem RECORRENTE.
 * Idempotência por (contratoId + unidadeId + período). Retorna a qtd criada.
 */
export async function gerarOsRecorrentesLocais(
  contratoId: string,
  usuarioId: string,
  limite = 12,
  origem: Origem = "contrato",
): Promise<number> {
  const ct = await prisma.contrato.findUnique({
    where: { id: contratoId },
    include: { recorrenciasLocais: true },
  });
  if (!ct) return 0;
  if (!contratoGeraFinanceiro(ct.status)) return 0; // CO2: só ATIVO gera OS

  const ativos = ct.recorrenciasLocais.filter((r) => r.ativa && r.frequencia && r.dataPrimeiraOs);
  if (ativos.length === 0) return 0;

  // Nomes dos tipos de OS para o título da atividade
  const tipoIds = [...new Set(ativos.map((r) => r.tipoOsId).filter(Boolean))] as string[];
  const tipos = tipoIds.length
    ? await prisma.tipoOs.findMany({ where: { id: { in: tipoIds } }, select: { id: true, nome: true, prazoExecucaoDias: true } })
    : [];
  const tipoNome = new Map(tipos.map((t) => [t.id, t.nome]));
  const tipoPrazo = new Map(tipos.map((t) => [t.id, t.prazoExecucaoDias]));

  let criadas = 0;
  for (const r of ativos) {
    const primeira = new Date(r.dataPrimeiraOs!);
    // Ao salvar: as 12 a partir da primeira OS (como sempre foi). Na rotina diária a janela anda com o
    // tempo — as 12 a partir de hoje (nunca antes da primeira) —, senão o local parava na 12ª para sempre.
    const hoje = new Date();
    const ocorrencias = proximasOcorrencias({
      dataInicio: primeira,
      dataFim: ct.dataFim,
      frequencia: r.frequencia,
      diaRecorrencia: diaDoMesCivil(primeira),
      fimSemana: r.fimSemana,
      limite,
      aPartirDe: origem === "rotina" && hoje > primeira ? hoje : primeira,
    });
    const titulo = (r.tipoOsId && tipoNome.get(r.tipoOsId)) || "Atendimento recorrente";
    if (ocorrencias.length === 0) continue;

    const doLocal = { empresaId: ct.empresaId, contratoId: ct.id, unidadeId: r.unidadeId };
    const periodoDe = (oc: { periodo: string }) => `L:${r.unidadeId}:${oc.periodo}`;
    const existentes = new Set((await prisma.ordemServico.findMany({
      where: { ...doLocal, periodoRecorrencia: { in: ocorrencias.map(periodoDe) } },
      select: { periodoRecorrencia: true },
    })).map((o) => o.periodoRecorrencia));

    for (const oc of ocorrencias) {
      const periodo = periodoDe(oc);
      if (existentes.has(periodo)) continue;

      // Número pelo contador da empresa (rótulo = ano da ocorrência), sob trava, na transação do INSERT
      const os = await criarSeFalta(ct.empresaId, { ...doLocal, periodoRecorrencia: periodo }, (numero, tx) => tx.ordemServico.create({
        data: {
          empresaId: ct.empresaId,
          numero,
          clienteId: ct.clienteId,
          contratoId: ct.id,
          unidadeId: r.unidadeId,
          criadoPorId: usuarioId,
          status: "AGENDADA",
          origem: "RECORRENTE",
          periodoRecorrencia: periodo,
          prioridade: "NORMAL",
          descricao: `${titulo} — contrato ${ct.numero} (${String(oc.mes).padStart(2, "0")}/${oc.ano})`,
          previsaoConclusao: oc.data,
          prazoExecucao: prazoPadrao(oc.data, r.tipoOsId ? tipoPrazo.get(r.tipoOsId) : null),
          atividades: (r.tipoOsId || r.tecnicoId)
            ? {
                create: {
                  empresaId: ct.empresaId,
                  tipoOsId: r.tipoOsId || null,
                  tecnicoId: r.tecnicoId || null,
                  titulo,
                  status: "AGENDADA",
                  dataAgendada: oc.data,
                },
              }
            : undefined,
        },
      }));
      if (!os) continue; // outra geração criou esta ocorrência no mesmo instante

      await prisma.osHistorico.create({
        data: {
          ordemServicoId: os.id,
          usuarioId,
          acao: "OS recorrente gerada",
          detalhes: origem === "rotina"
            ? `Gerada automaticamente pela rotina diária do contrato ${ct.numero} (local) (${oc.periodo}).`
            : `Gerada automaticamente do contrato ${ct.numero} (local) (${oc.periodo}).`,
        },
      });

      criadas++;
    }
  }

  return criadas;
}

/* ───────── horizonte rolante (rotina diária) ───────── */

/**
 * Em nome de quem a rotina cria a OS (a OS e o histórico exigem um usuário): quem gerou a última OS
 * recorrente do contrato — quem configurou a recorrência — e, se o contrato ainda não tem nenhuma,
 * o administrador ativo mais antigo da empresa. null = empresa sem ninguém para assinar (não gera).
 */
async function autorDaRotina(ct: { id: string; empresaId: string }, admins: Map<string, string | null>): Promise<string | null> {
  const ultima = await prisma.ordemServico.findFirst({
    where: { empresaId: ct.empresaId, contratoId: ct.id, origem: "RECORRENTE" },
    orderBy: { criadoEm: "desc" },
    select: { criadoPorId: true },
  });
  if (ultima) return ultima.criadoPorId;
  if (!admins.has(ct.empresaId)) {
    const admin = await prisma.usuario.findFirst({
      where: { empresaId: ct.empresaId, ativo: true, role: "ADMIN" },
      orderBy: { criadoEm: "asc" },
      select: { id: true },
    });
    admins.set(ct.empresaId, admin?.id ?? null);
  }
  return admins.get(ct.empresaId) ?? null;
}

/**
 * Horizonte rolante das OS recorrentes: todo contrato ATIVO com recorrência (a do contrato ou a de
 * algum local) ganha as ocorrências que faltam até 12 à frente. É o que ao salvar o contrato já
 * acontecia — agora todo dia, sem ninguém clicar: o contrato que ninguém edita há um ano não fica
 * sem OS. Idempotente (não repete ocorrência; a OS cancelada continua contando como gerada).
 */
export async function rolarHorizonteDeOsRecorrentes(o: { empresaId?: string } = {}) {
  const contratos = await prisma.contrato.findMany({
    where: {
      ...(o.empresaId ? { empresaId: o.empresaId } : {}),
      status: "ATIVO",
      OR: [
        { recorrencia: true, frequenciaRecorrencia: { not: null } },
        { recorrenciasLocais: { some: { ativa: true } } },
      ],
    },
    select: { id: true, empresaId: true, recorrencia: true },
    orderBy: { criadoEm: "asc" },
  });
  const admins = new Map<string, string | null>();
  let os = 0;
  let falhas = 0;
  let semAutor = 0;
  for (const ct of contratos) {
    try {
      const usuarioId = await autorDaRotina(ct, admins);
      if (!usuarioId) { semAutor++; continue; }
      os += await gerarOsRecorrentesLocais(ct.id, usuarioId, 12, "rotina");
      if (ct.recorrencia) os += await gerarOsRecorrentesContrato(ct.id, usuarioId, 12, "rotina");
    } catch (e) {
      falhas++;
      console.error("[os recorrentes] contrato", ct.id, (e as Error)?.message);
    }
  }
  return { contratos: contratos.length, os, falhas, semAutor };
}
