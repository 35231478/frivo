/**
 * OS EM CAMPANHA / MÚLTIPLAS VISITAS (servidor): lê as visitas da OS, monta o que a tela mostra e
 * APLICA o resultado de uma operação numa transação. As regras estão em lib/os/visitas.ts.
 *
 * Como as visitas se ligam à OS: cada visita é uma linha de `atividades_os` da própria OS, marcada
 * com `plano_visitas_id`; o lote de cada uma fica em `atividade_equipamentos`. Nada de tabela
 * paralela de agenda — por isso o calendário, o app do técnico, o relatório e a conclusão
 * automática da OS já enxergam as visitas.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chaveDiaBR, instanteBR, partesBR } from "@/lib/fuso";
import { textoTecnicosAtividade } from "@/lib/atividade-equipe";
import { ErroTecnicos, gravarTecnicos, resolverTecnicos, resolverVeiculo } from "@/lib/atividade-tecnicos";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import {
  MINIMO_PARA_PLANEJAR, POR_DIA_SUGERIDO, diaUtil, incluirDia, moverEquipamentos, moverVisita, numerarVisitas, ordemDoEquipamento, pendentesEmOrdem,
  planejarVisitas, progressoDasVisitas, resumoDoPlano, sobras, tirarDia, visitaPendente,
  type EstadoVisitasTela, type ExecutorDoPlano, type PedidoVisitas, type PlanoDeVisitas, type Resultado, type VisitaAtual, type VisitaTela,
} from "@/lib/os/visitas";

type Db = Prisma.TransactionClient | typeof prisma;

/** Erro de regra: vira a resposta da rota com este status */
export class ErroVisitas extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const SELECT_ATIVIDADE = {
  id: true, titulo: true, status: true, dataAgendada: true, duracaoMin: true, observacao: true, tipoOsId: true, planoVisitasId: true,
  tecnicoId: true, equipeId: true, veiculoId: true,
  tecnico: { select: { id: true, nome: true } },
  equipe: { select: { id: true, nome: true } },
  tecnicosEquipe: { select: { tecnicoId: true, tecnico: { select: { nome: true } } }, orderBy: { criadoEm: "asc" } },
  equipamentos: {
    select: { equipamentoId: true, feito: true, observacao: true, equipamento: { select: { nome: true, marca: true, modelo: true, patrimonio: true, setor: true, localizacao: true } } },
  },
  // Qualquer um destes é registro de execução: a visita deixa de ser "pendente"
  _count: { select: { respostas: true, respostasEquipamento: true, relatorios: true, checklistRespostas: true, fotosAtendimento: true, servicosAdicionais: true, avisosCliente: true } },
} satisfies Prisma.AtividadeOsSelect;
type Atividade = Prisma.AtividadeOsGetPayload<{ select: typeof SELECT_ATIVIDADE }>;

const rotulo = (e: Atividade["equipamentos"][number]["equipamento"]) => [e.patrimonio, e.nome || `${e.marca} ${e.modelo}`.trim()].filter(Boolean).join(" · ");
const local = (e: Atividade["equipamentos"][number]["equipamento"]) => [e.setor, e.localizacao].filter(Boolean).join(" · ") || null;
const equipamentosDaTela = (a: Atividade): VisitaTela["equipamentos"] => a.equipamentos
  .map((v) => ({ id: v.equipamentoId, rotulo: rotulo(v.equipamento), local: local(v.equipamento), feito: v.feito, ordem: ordemDoEquipamento(v.equipamento) }));
const executorDe = (a: Atividade): ExecutorDoPlano | null => {
  const ids = [...new Set([a.tecnicoId, ...a.tecnicosEquipe.map((t) => t.tecnicoId)].filter((x): x is string => !!x))];
  return ids.length || a.equipeId ? { tecnicoIds: ids, responsavelId: a.tecnicoId, equipeId: a.equipeId, veiculoId: a.veiculoId } : null;
};
const paraRegra = (a: Atividade): VisitaAtual => ({
  id: a.id, status: a.status, dia: a.dataAgendada ? chaveDiaBR(a.dataAgendada) : null,
  executada: Object.values(a._count).some((n) => n > 0) || a.equipamentos.some((e) => !!e.observacao?.trim()),
  equipamentos: a.equipamentos.map((e) => ({ id: e.equipamentoId, feito: e.feito, ordem: ordemDoEquipamento(e.equipamento) })),
});

const OS_FECHADA = ["CONCLUIDA", "CANCELADA"];
const MSG_SEM_ORIGEM = `Para planejar visitas, a OS precisa de uma atividade agendada, ainda não iniciada, com ${MINIMO_PARA_PLANEJAR} equipamentos ou mais.`;

interface Contexto {
  os: { id: string; status: string; previsaoConclusao: Date | null };
  plano: { id: string; porDia: number; pularFimSemana: boolean } | null;
  atividades: Atividade[];
  /** As visitas do plano; antes do primeiro planejamento, a atividade a dividir */
  visitas: Atividade[];
  origem: Atividade | null;
}

/** Tudo o que as regras precisam saber da OS (null = a OS não é desta empresa) */
async function carregar(db: Db, osId: string, empresaId: string, atividadeId?: string): Promise<Contexto | null> {
  const os = await db.ordemServico.findFirst({
    where: { id: osId, empresaId },
    select: {
      id: true, status: true, previsaoConclusao: true,
      planoVisitas: { select: { id: true, porDia: true, pularFimSemana: true } },
      atividades: { select: SELECT_ATIVIDADE, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] },
    },
  });
  if (!os) return null;
  const plano = os.planoVisitas;
  if (plano) return { os, plano, atividades: os.atividades, visitas: os.atividades.filter((a) => a.planoVisitasId === plano.id), origem: null };
  // Primeiro planejamento: divide UMA atividade — a pedida ou a pendente com mais equipamentos
  const candidatas = os.atividades.filter((a) => visitaPendente(paraRegra(a)) && a.equipamentos.length >= MINIMO_PARA_PLANEJAR);
  const origem = atividadeId ? candidatas.find((a) => a.id === atividadeId) ?? null
    : [...candidatas].sort((a, b) => b.equipamentos.length - a.equipamentos.length)[0] ?? null;
  return { os, plano: null, atividades: os.atividades, visitas: origem ? [origem] : [], origem };
}

function bloqueioDe(c: Contexto): string | null {
  if (OS_FECHADA.includes(c.os.status)) return c.os.status === "CANCELADA" ? "OS cancelada: não dá para planejar visitas." : "OS concluída: não dá para planejar visitas.";
  if (!c.plano && !c.origem) return MSG_SEM_ORIGEM;
  return null;
}

/** O que o painel "Visitas" e o diálogo mostram (null = a OS não é desta empresa) */
export async function estadoDasVisitas(osId: string, empresaId: string, agora: Date = new Date()): Promise<EstadoVisitasTela | null> {
  const c = await carregar(prisma, osId, empresaId);
  if (!c) return null;
  const hoje = chaveDiaBR(agora);
  const doPlano = c.plano ? c.visitas : [];
  const regras = c.visitas.map(paraRegra);
  const numeros = numerarVisitas(doPlano);
  const pendentes = pendentesEmOrdem(regras);
  const primeira = pendentes[0] ? c.visitas.find((a) => a.id === pendentes[0].id)! : c.origem;
  const pularFimSemana = c.plano?.pularFimSemana ?? true;
  const total = pendentes.reduce((s, v) => s + v.equipamentos.length, 0);
  const diaBase = primeira?.dataAgendada ? chaveDiaBR(primeira.dataAgendada) : hoje;
  return {
    plano: c.plano ? { porDia: c.plano.porDia, pularFimSemana: c.plano.pularFimSemana } : null,
    visitas: doPlano.map((a): VisitaTela => ({
      id: a.id, titulo: a.titulo, status: a.status, dataAgendada: a.dataAgendada?.toISOString() ?? null, dia: a.dataAgendada ? chaveDiaBR(a.dataAgendada) : null,
      numero: numeros.get(a.id)?.numero ?? null, pendente: visitaPendente(paraRegra(a)), executor: textoTecnicosAtividade(a), equipamentos: equipamentosDaTela(a),
    })).sort((a, b) => (a.numero ?? 9999) - (b.numero ?? 9999)),
    progresso: progressoDasVisitas(c.plano ? regras : []),
    sobras: c.plano ? sobras(regras).length : 0,
    origem: c.origem ? { id: c.origem.id, titulo: c.origem.titulo, equipamentos: equipamentosDaTela(c.origem), dataAgendada: c.origem.dataAgendada?.toISOString() ?? null } : null,
    executorModelo: primeira ? executorDe(primeira) : null,
    bloqueio: bloqueioDe(c),
    proposta: {
      inicio: diaUtil(diaBase < hoje ? hoje : diaBase, pularFimSemana),
      porDia: c.plano?.porDia ?? Math.max(1, Math.min(POR_DIA_SUGERIDO, total || POR_DIA_SUGERIDO)),
      pularFimSemana,
    },
    hoje,
  };
}

export interface AtorVisitas { empresaId: string; usuarioId: string }
export interface ResultadoVisitas { visitas: number; criadas: number; removidas: number; de: string | null; ate: string | null; equipamentos: number }

const br = (dia: string | null) => (dia ? dia.split("-").reverse().join("/") : "—");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** A regra de cada operação sobre o estado atual */
function calcular(regras: VisitaAtual[], p: PedidoVisitas, hoje: string): Resultado {
  switch (p.acao) {
    case "PLANEJAR": return planejarVisitas(regras, p, hoje);
    case "MOVER_VISITA": return moverVisita(regras, p.visitaId, p.dia, hoje);
    case "INCLUIR_DIA": return incluirDia(regras, p.dia, hoje);
    case "TIRAR_DIA": return tirarDia(regras, p.visitaId);
    case "MOVER_EQUIPAMENTOS": return moverEquipamentos(regras, p.equipamentoIds, p.paraVisitaId);
  }
}

/**
 * Executa uma operação do planejamento. Tudo numa transação, com trava por OS (dois cliques ao mesmo
 * tempo não criam visita em dobro). Devolve null se a OS não é desta empresa; regra quebrada lança
 * ErroVisitas. Depois de gravar, o status automático da OS é alinhado.
 */
export async function executarVisitas(osId: string, ator: AtorVisitas, pedido: PedidoVisitas, agora: Date = new Date()): Promise<ResultadoVisitas | null> {
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`os-visitas:${osId}`}))`;
    const c = await carregar(tx, osId, ator.empresaId, pedido.acao === "PLANEJAR" ? pedido.atividadeId : undefined);
    if (!c) return null;
    const bloqueio = bloqueioDe(c);
    if (bloqueio) throw new ErroVisitas(bloqueio, 409);
    if (pedido.acao !== "PLANEJAR" && !c.plano) throw new ErroVisitas("Esta OS ainda não tem visitas planejadas.", 409);

    const regras = c.visitas.map(paraRegra);
    const calculado = calcular(regras, pedido, chaveDiaBR(agora));
    if (calculado.erro !== undefined) throw new ErroVisitas(calculado.erro);
    const plano = calculado.plano;

    // O plano da OS (um por OS): nasce no primeiro planejamento e guarda os parâmetros do último
    const planoId = pedido.acao === "PLANEJAR"
      ? (await tx.osPlanoVisitas.upsert({
          where: { ordemServicoId: osId },
          create: { empresaId: ator.empresaId, ordemServicoId: osId, porDia: pedido.porDia, pularFimSemana: pedido.pularFimSemana, criadoPorId: ator.usuarioId },
          update: { porDia: pedido.porDia, pularFimSemana: pedido.pularFimSemana },
          select: { id: true },
        })).id
      : c.plano!.id;

    const executor = pedido.acao === "PLANEJAR" && pedido.executor ? await resolverExecutor(ator.empresaId, pedido.executor, c) : undefined;
    const resultado = await aplicar(tx, c, plano, { planoId, empresaId: ator.empresaId, executor });

    await tx.osHistorico.create({ data: { ordemServicoId: osId, usuarioId: ator.usuarioId, ...textoDoHistorico(pedido, c, plano, resultado) } });
    return resultado;
  }, { timeout: 120_000, maxWait: 20_000 });
  if (r) await sincronizarStatusOs(osId, ator.empresaId, ator.usuarioId);
  return r;
}

type ExecutorResolvido = { responsavel: string | null; outros: string[]; equipeId: string | null; veiculoId: string | null };

/** Quem executa as visitas: as MESMAS validações de uma atividade comum (ativo, competência, equipe ativa, veículo da empresa) */
async function resolverExecutor(empresaId: string, e: ExecutorDoPlano, c: Contexto): Promise<ExecutorResolvido> {
  const tipoOsId = (c.origem ?? c.visitas[0])?.tipoOsId ?? null;
  try {
    const t = await resolverTecnicos(empresaId, { tecnicoIds: e.tecnicoIds, responsavelId: e.responsavelId ?? null, equipeId: e.equipeId ?? null }, tipoOsId, { exigir: false });
    // Sem ninguém e sem equipe: nasce "sem quem execute", e sem veículo
    const vazio = !t.responsavel && !t.equipeId;
    return { ...t, veiculoId: vazio ? null : await resolverVeiculo(empresaId, e.veiculoId, t) };
  } catch (erro) { if (erro instanceof ErroTecnicos) throw new ErroVisitas(erro.message); throw erro; }
}

/** A hora (Brasília) das visitas: a da atividade que serve de modelo; sem data, 8h */
function horaDe(a: Atividade | null | undefined): { hora: number; minuto: number } {
  if (!a?.dataAgendada) return { hora: 8, minuto: 0 };
  const p = partesBR(a.dataAgendada);
  return { hora: p.hora, minuto: p.minuto };
}
function instante(dia: string, h: { hora: number; minuto: number }): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return instanteBR(a, m - 1, d, h.hora, h.minuto);
}

/**
 * Deixa o banco igual ao plano: remove as visitas pendentes que saíram, cria as novas (cópia do
 * modelo), acerta dia e lote das reaproveitadas. Só toca em visita pendente — confere de novo, dentro
 * da transação, que nada começou no meio do caminho.
 */
async function aplicar(tx: Prisma.TransactionClient, c: Contexto, plano: PlanoDeVisitas, o: { planoId: string; empresaId: string; executor?: ExecutorResolvido }): Promise<ResultadoVisitas> {
  const porId = new Map(c.visitas.map((a) => [a.id, a]));
  const mexidas = [...plano.remover, ...plano.visitas.map((v) => v.id).filter((id): id is string => !!id)];
  for (const id of mexidas) {
    const a = porId.get(id);
    if (!a || !visitaPendente(paraRegra(a))) throw new ErroVisitas("Uma das visitas começou enquanto o planejamento era feito. Abra de novo e confira.", 409);
  }
  // O modelo das visitas novas: a atividade dividida ou, com o plano feito, a última visita pendente
  const pendentes = pendentesEmOrdem(c.visitas.map(paraRegra));
  const modelo = c.origem ?? porId.get(pendentes.at(-1)?.id ?? "") ?? c.visitas.at(-1)!;
  const horaModelo = horaDe(c.origem ?? porId.get(pendentes[0]?.id ?? "") ?? modelo);

  if (plano.remover.length) await tx.atividadeOs.deleteMany({ where: { id: { in: plano.remover }, ordemServicoId: c.os.id, status: "AGENDADA" } });

  let criadas = 0;
  for (const v of plano.visitas) {
    const atual = v.id ? porId.get(v.id)! : null;
    const dataAgendada = instante(v.dia, atual?.dataAgendada ? horaDe(atual) : horaModelo);
    let id = v.id;
    if (!atual) {
      const nova = await tx.atividadeOs.create({
        data: {
          empresaId: o.empresaId, ordemServicoId: c.os.id, planoVisitasId: o.planoId, status: "AGENDADA", dataAgendada,
          titulo: modelo.titulo, tipoOsId: modelo.tipoOsId, duracaoMin: modelo.duracaoMin, observacao: modelo.observacao,
          tecnicoId: modelo.tecnicoId, equipeId: modelo.equipeId, veiculoId: modelo.veiculoId,
          tecnicosEquipe: { create: modelo.tecnicosEquipe.map((t) => ({ tecnicoId: t.tecnicoId })) },
          equipamentos: { create: v.equipamentoIds.map((equipamentoId) => ({ equipamentoId })) },
        },
        select: { id: true },
      });
      id = nova.id; criadas++;
    } else {
      if (atual.planoVisitasId !== o.planoId || atual.dataAgendada?.getTime() !== dataAgendada.getTime())
        await tx.atividadeOs.update({ where: { id: atual.id }, data: { planoVisitasId: o.planoId, dataAgendada } });
      const tem = new Set(atual.equipamentos.map((e) => e.equipamentoId)), quer = new Set(v.equipamentoIds);
      const saem = [...tem].filter((e) => !quer.has(e)), entram = v.equipamentoIds.filter((e) => !tem.has(e));
      if (saem.length) await tx.atividadeEquipamento.deleteMany({ where: { atividadeId: atual.id, equipamentoId: { in: saem }, feito: false } });
      if (entram.length) await tx.atividadeEquipamento.createMany({ data: entram.map((equipamentoId) => ({ atividadeId: atual.id, equipamentoId })), skipDuplicates: true });
    }
    if (o.executor) {
      await gravarTecnicos(tx, id!, o.executor);
      await tx.atividadeOs.update({ where: { id: id! }, data: { veiculoId: o.executor.veiculoId } });
    }
  }

  // A OS termina quando a última visita termina: a previsão de conclusão acompanha (nunca encurta)
  const fixas = c.visitas.filter((a) => a.status !== "CANCELADA" && !mexidas.includes(a.id) && a.dataAgendada).map((a) => a.dataAgendada!.getTime());
  const ultima = Math.max(...fixas, ...plano.visitas.map((v) => instante(v.dia, horaModelo).getTime()));
  if (Number.isFinite(ultima) && (!c.os.previsaoConclusao || c.os.previsaoConclusao.getTime() < ultima))
    await tx.ordemServico.update({ where: { id: c.os.id }, data: { previsaoConclusao: new Date(ultima) } });

  const resumo = resumoDoPlano(plano);
  return { visitas: resumo.visitas, criadas, removidas: plano.remover.length, de: resumo.de, ate: resumo.ate, equipamentos: resumo.equipamentos };
}

function textoDoHistorico(p: PedidoVisitas, c: Contexto, plano: PlanoDeVisitas, r: ResultadoVisitas): { acao: string; detalhes: string } {
  const periodo = r.de === r.ate ? `em ${br(r.de)}` : `de ${br(r.de)} a ${br(r.ate)}`;
  switch (p.acao) {
    case "PLANEJAR": return {
      acao: c.plano ? "Visitas replanejadas" : "Visitas planejadas",
      detalhes: `${plural(r.equipamentos, "equipamento", "equipamentos")} em ${plural(r.visitas, "visita", "visitas")}, ${periodo} (${p.porDia} por dia${p.pularFimSemana ? ", sem sábado e domingo" : ""}).`,
    };
    case "MOVER_VISITA": {
      const antes = c.visitas.find((a) => a.id === p.visitaId)?.dataAgendada;
      return { acao: "Visita movida de dia", detalhes: `De ${antes ? br(chaveDiaBR(antes)) : "sem data"} para ${br(p.dia)}.` };
    }
    case "INCLUIR_DIA": return { acao: "Dia incluído nas visitas", detalhes: `${br(p.dia)}: agora são ${plural(r.visitas, "visita pendente", "visitas pendentes")}, ${periodo}.` };
    case "TIRAR_DIA": {
      const dia = c.visitas.find((a) => a.id === p.visitaId)?.dataAgendada;
      return { acao: "Dia retirado das visitas", detalhes: `${dia ? br(chaveDiaBR(dia)) : "Visita sem data"}: os equipamentos foram para as outras ${plural(r.visitas, "visita", "visitas")}.` };
    }
    case "MOVER_EQUIPAMENTOS": {
      const destino = plano.visitas.find((v) => v.id === p.paraVisitaId);
      return { acao: "Equipamentos movidos entre visitas", detalhes: `${plural(p.equipamentoIds.length, "equipamento", "equipamentos")} para a visita de ${br(destino?.dia ?? null)}.` };
    }
  }
}

/** "Visita 3 de 12" das atividades que são visitas (para o app do técnico e o calendário) */
export async function numerosDasVisitas(atividades: { id: string; planoVisitasId: string | null }[]): Promise<Map<string, { numero: number; total: number }>> {
  const planos = [...new Set(atividades.map((a) => a.planoVisitasId).filter((x): x is string => !!x))];
  const out = new Map<string, { numero: number; total: number }>();
  if (!planos.length) return out;
  const todas = await prisma.atividadeOs.findMany({ where: { planoVisitasId: { in: planos } }, select: { id: true, status: true, dataAgendada: true, planoVisitasId: true } });
  for (const planoId of planos) for (const [id, n] of numerarVisitas(todas.filter((a) => a.planoVisitasId === planoId))) out.set(id, n);
  return out;
}
