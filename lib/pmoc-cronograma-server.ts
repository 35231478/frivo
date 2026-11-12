/**
 * PMOC — Etapa 2: cronograma, lado do servidor. Carrega o estado do plano, pede o PLANO às regras
 * puras (lib/pmoc-cronograma) e aplica numa transação só, sob uma trava por plano
 * (`pg_advisory_xact_lock`, o mesmo padrão da numeração): dois "Reagendar" ao mesmo tempo esperam um
 * pelo outro, e a chave única das execuções fecha a porta para OS duplicada.
 *
 * As OS nascem como as recorrentes dos contratos: número pelo contador da empresa, status AGENDADA,
 * origem RECORRENTE, uma atividade com o tipo de OS e a data — e os equipamentos na atividade, como
 * em qualquer OS aberta à mão. Por isso aparecem no calendário e na lista de OS sem nada a mais.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reservarNumeros } from "@/lib/numeracao-server";
import { motivoBloqueioInativacao } from "@/lib/os-server";
import { chaveDiaBR } from "@/lib/fuso";
import { dataBR, dataISO, hojeISO } from "@/lib/pmoc";
import {
  descricaoDaOs, equipamentoNoItem, equipamentosSemCronograma, execucaoPendente, execucoesDesejadas, periodoDaOs, planejarCronograma,
  nomeComPmoc, resumirPlano, soCriar, type EstadoCronograma, type ExecucaoExistente, type ItemCronograma, type MotivoSemGerar, type OsDaExecucao,
  type PlanoCronograma, type ResumoPlano,
} from "@/lib/pmoc-cronograma";

type Db = Prisma.TransactionClient | typeof prisma;

export const SELECT_ITEM_CRONOGRAMA = {
  id: true, ativo: true, tipoEquipamentoId: true, equipamentoId: true, tipoOsId: true, dataInicio: true, intervaloMeses: true, diaExecucao: true,
  fimSemana: true, criadoEm: true,
  tipoOs: { select: { id: true, nome: true, ativo: true } },
  tipoEquipamento: { select: { id: true, nome: true } },
  equipamento: { select: { id: true, nome: true, marca: true, modelo: true, patrimonio: true, ativo: true } },
} as const;

interface PlanoCarregado {
  id: string; nome: string; empresaId: string; clienteId: string;
  estado: EstadoCronograma;
  tipoOsNome: Map<string, string>;
  /** Os itens como vieram do banco (com tipo de OS, tipo de equipamento e equipamento) */
  linhas: LinhaCronograma[];
}
type LinhaCronograma = Prisma.PmocCronogramaGetPayload<{ select: typeof SELECT_ITEM_CRONOGRAMA }>;

/** Tudo o que o planejamento precisa saber do plano (null = plano não existe nesta empresa) */
export async function carregarCronograma(db: Db, pmocId: string, empresaId: string): Promise<PlanoCarregado | null> {
  const pmoc = await db.pmoc.findFirst({
    where: { id: pmocId, empresaId },
    select: {
      id: true, nome: true, empresaId: true, clienteId: true, status: true, ativo: true, dataInicio: true, dataExpiracao: true,
      equipamentos: { select: { equipamento: { select: { id: true, ativo: true, unidadeId: true, tipoEquipamentoId: true, tipo: true } } } },
      cronograma: { select: { ...SELECT_ITEM_CRONOGRAMA }, orderBy: { criadoEm: "asc" } },
      execucoes: { select: { id: true, cronogramaId: true, equipamentoId: true, periodo: true, dataPrevista: true, ordemServicoId: true } },
    },
  });
  if (!pmoc) return null;
  const [tipos, ordens] = await Promise.all([
    db.tipoEquipamentoCustom.findMany({ where: { empresaId }, select: { id: true, chaveEnum: true } }),
    carregarOs(db, [...new Set(pmoc.execucoes.map((x) => x.ordemServicoId).filter((id): id is string => !!id))]),
  ]);
  const itens: ItemCronograma[] = pmoc.cronograma.map((i) => ({
    id: i.id, ativo: i.ativo, tipoEquipamentoId: i.tipoEquipamentoId, equipamentoId: i.equipamentoId, tipoOsId: i.tipoOsId,
    dataInicio: dataISO(i.dataInicio)!, intervaloMeses: i.intervaloMeses, diaExecucao: i.diaExecucao,
    fimSemana: i.fimSemana, criadoEm: i.criadoEm.toISOString(),
  }));
  const execucoes: ExecucaoExistente[] = pmoc.execucoes.map((x) => ({
    id: x.id, cronogramaId: x.cronogramaId, equipamentoId: x.equipamentoId, periodo: x.periodo, dataPrevista: x.dataPrevista.toISOString(),
    os: x.ordemServicoId ? ordens.get(x.ordemServicoId) ?? null : null,
  }));
  return {
    id: pmoc.id, nome: pmoc.nome, empresaId: pmoc.empresaId, clienteId: pmoc.clienteId,
    estado: {
      pmoc: { status: pmoc.status, ativo: pmoc.ativo, dataInicio: dataISO(pmoc.dataInicio)!, dataExpiracao: dataISO(pmoc.dataExpiracao)! },
      itens, equipamentos: pmoc.equipamentos.map((v) => v.equipamento), tipos, execucoes,
    },
    tipoOsNome: new Map(pmoc.cronograma.map((i) => [i.tipoOsId, i.tipoOs.nome])),
    linhas: pmoc.cronograma,
  };
}

/** As OS das execuções, com a atividade gerada (a primeira) e os equipamentos dela */
async function carregarOs(db: Db, ids: string[]): Promise<Map<string, OsDaExecucao>> {
  if (!ids.length) return new Map();
  const ordens = await db.ordemServico.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, numero: true, status: true, planoVisitas: { select: { id: true } },
      atividades: { orderBy: { criadoEm: "asc" }, select: { id: true, status: true, dataAgendada: true, equipamentos: { select: { equipamentoId: true, feito: true } } } },
    },
  });
  return new Map(ordens.map((o) => {
    // OS dividida em VISITAS (lib/os/visitas): os equipamentos estão espalhados pelas atividades — conta
    // todas as não canceladas, e o reagendamento do cronograma não mexe nela (`emVisitas`)
    const emVisitas = !!o.planoVisitas;
    const a = o.atividades[0];
    const consideradas = emVisitas ? o.atividades.filter((x) => x.status !== "CANCELADA") : a ? [a] : [];
    const vinculos = consideradas.flatMap((x) => x.equipamentos);
    return [o.id, {
      id: o.id, numero: o.numero, status: o.status, atividadeId: a?.id ?? null, atividadeStatus: a?.status ?? null,
      dataAgendada: a?.dataAgendada?.toISOString() ?? null,
      equipamentoIds: [...new Set(vinculos.map((e) => e.equipamentoId))], feitos: [...new Set(vinculos.filter((e) => e.feito).map((e) => e.equipamentoId))],
      ...(emVisitas ? { emVisitas } : {}),
    }];
  }));
}

export interface AtorCronograma { empresaId: string; usuarioId: string; /** Tem "Ordens de serviço › Excluir" (cancelar/inativar OS)? */ podeCancelarOs: boolean }
export interface ResultadoCronograma {
  motivo: MotivoSemGerar | null;
  /** OS criadas agora */
  criadas: { id: string; numero: string }[];
  /** Equipamentos incluídos em OS que já existiam */
  incluidos: number;
  /** OS que mudaram de data */
  movidas: number;
  /** Equipamentos retirados de OS que continuam valendo */
  retirados: number;
  /** OS canceladas por terem ficado sem equipamento */
  canceladas: number;
  /** OS com data mudada à mão: ficaram como estavam */
  mantidas: number;
  /** OS que ficariam sem equipamento, mas quem pediu não pode cancelar OS (ou a OS já está no financeiro) */
  aCancelar: number;
}

const brDe = (d: Date | string) => dataBR(chaveDiaBR(d));

/**
 * Aplica o cronograma à agenda. `modo`:
 *  - "criar": só cria o que falta (roda sozinho ao publicar o plano e ao salvar o cronograma);
 *  - "reagendar": o plano completo (cria, muda datas, retira equipamentos e cancela OS vazias).
 * null = plano não existe nesta empresa.
 */
export async function executarCronograma(pmocId: string, ator: AtorCronograma, modo: "criar" | "reagendar", agora: Date = new Date()): Promise<ResultadoCronograma | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pmoc-cronograma:${pmocId}`}))`;
    const c = await carregarCronograma(tx, pmocId, ator.empresaId);
    if (!c) return null;
    const completo = planejarCronograma(c.estado, agora);
    const plano: PlanoCronograma = modo === "criar" ? soCriar(completo) : completo;
    const r: ResultadoCronograma = { motivo: plano.motivo, criadas: [], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0, mantidas: plano.mantidas.length, aCancelar: 0 };
    const itemPorId = new Map(c.estado.itens.map((i) => [i.id, i]));
    const historico = (ordemServicoId: string, acao: string, detalhes: string) => tx.osHistorico.create({ data: { ordemServicoId, usuarioId: ator.usuarioId, acao, detalhes } });

    // 1. OS novas: uma por (item, competência, local), com todos os equipamentos na atividade
    const numeros = await reservarNumeros(tx, c.empresaId, "os", plano.criar.length);
    for (const [i, nova] of plano.criar.entries()) {
      const tipoOsId = itemPorId.get(nova.itemId)!.tipoOsId;
      const titulo = c.tipoOsNome.get(tipoOsId) ?? "Manutenção preventiva";
      const os = await tx.ordemServico.create({
        data: {
          empresaId: c.empresaId, numero: numeros[i], clienteId: c.clienteId, unidadeId: nova.unidadeId, criadoPorId: ator.usuarioId,
          status: "AGENDADA", origem: "RECORRENTE", periodoRecorrencia: periodoDaOs(nova.periodo), prioridade: "NORMAL",
          descricao: descricaoDaOs(titulo, c.nome, nova.periodo), previsaoConclusao: nova.data,
          atividades: { create: {
            empresaId: c.empresaId, tipoOsId, titulo, status: "AGENDADA", dataAgendada: nova.data,
            equipamentos: { create: nova.equipamentoIds.map((equipamentoId) => ({ equipamentoId })) },
          } },
          historico: { create: { usuarioId: ator.usuarioId, acao: "OS gerada pelo cronograma do PMOC", detalhes: `Plano ${c.nome}, competência ${nova.periodo}: ${nova.equipamentoIds.length} equipamento(s).` } },
        },
        select: { id: true, numero: true },
      });
      await tx.pmocExecucao.createMany({
        data: nova.equipamentoIds.map((equipamentoId) => ({ pmocId: c.id, cronogramaId: nova.itemId, equipamentoId, periodo: nova.periodo, dataPrevista: nova.data, ordemServicoId: os.id })),
      });
      r.criadas.push(os);
    }

    // 2. Equipamento que faltava numa OS que já existe (ainda não iniciada) do mesmo item/competência/local
    const incluidosPorOs = new Map<string, number>();
    for (const inc of plano.incluir) {
      await tx.atividadeEquipamento.createMany({ data: [{ atividadeId: inc.atividadeId, equipamentoId: inc.equipamentoId }], skipDuplicates: true });
      await tx.pmocExecucao.create({ data: { pmocId: c.id, cronogramaId: inc.itemId, equipamentoId: inc.equipamentoId, periodo: inc.periodo, dataPrevista: inc.data, ordemServicoId: inc.osId } });
      incluidosPorOs.set(inc.osId, (incluidosPorOs.get(inc.osId) ?? 0) + 1);
      r.incluidos++;
    }
    for (const [osId, n] of incluidosPorOs) await historico(osId, "Equipamento incluído pelo cronograma do PMOC", `Plano ${c.nome}: ${n} equipamento(s) incluído(s).`);

    // 3. OS cuja data o cronograma mudou
    for (const m of plano.mover) {
      await tx.atividadeOs.update({ where: { id: m.atividadeId }, data: { dataAgendada: m.para } });
      await tx.ordemServico.update({ where: { id: m.osId }, data: { previsaoConclusao: m.para } });
      await tx.pmocExecucao.updateMany({ where: { id: { in: m.execucaoIds } }, data: { dataPrevista: m.para } });
      await historico(m.osId, "OS reagendada pelo cronograma do PMOC", `Plano ${c.nome}: de ${brDe(m.de)} para ${brDe(m.para)}.`);
      r.movidas++;
    }

    // Quem substituiu: o tipo de OS do item de maior intervalo que passou a atender o equipamento no mês
    const servicoDe = (itemId: string) => c.tipoOsNome.get(itemPorId.get(itemId)?.tipoOsId ?? "") ?? "outro serviço";
    const servicos = (rets: typeof plano.retirar) => [...new Set(rets.map((x) => servicoDe(x.substituidoPor!)))].sort().join(", ");

    // 4. OS que ficam sem equipamento: cancela (= inativa, a regra da casa) — se quem pediu pode e nada trava
    const naoCanceladas = new Set<string>();
    for (const osId of plano.cancelar) {
      const bloqueio = ator.podeCancelarOs ? await motivoBloqueioInativacao(osId) : "sem permissão";
      if (bloqueio) { naoCanceladas.add(osId); r.aCancelar++; continue; }
      const antes = await tx.ordemServico.findUnique({ where: { id: osId }, select: { status: true } });
      await tx.ordemServico.update({ where: { id: osId }, data: { status: "CANCELADA" } });
      // Ficou vazia porque TODOS os equipamentos passaram para um serviço de maior intervalo? O motivo diz qual.
      const daOs = plano.retirar.filter((x) => x.osId === osId);
      const porque = daOs.length && daOs.every((x) => x.substituidoPor) ? `substituída por ${servicos(daOs)} nesta competência` : "nenhum equipamento a atender nesta competência";
      await historico(osId, "OS inativada (cancelada)", `${antes?.status ?? ""} → CANCELADA — Motivo: cronograma do ${nomeComPmoc(c.nome)} (${porque}).`);
      r.canceladas++;
    }
    const canceladas = new Set(plano.cancelar.filter((id) => !naoCanceladas.has(id)));

    // 5. Equipamento que saiu do cronograma. Na OS cancelada, o conteúdo fica (reabrir devolve tudo);
    //    na que não pôde ser cancelada, nada muda (a execução continua lá até alguém cancelar).
    const retiradosPorOs = new Map<string, typeof plano.retirar>();
    for (const ret of plano.retirar) {
      if (naoCanceladas.has(ret.osId)) continue;
      await tx.pmocExecucao.delete({ where: { id: ret.execucaoId } });
      if (canceladas.has(ret.osId)) continue;
      await tx.atividadeEquipamento.deleteMany({ where: { atividadeId: ret.atividadeId, equipamentoId: ret.equipamentoId, feito: false } });
      retiradosPorOs.set(ret.osId, [...(retiradosPorOs.get(ret.osId) ?? []), ret]);
      r.retirados++;
    }
    for (const [osId, rets] of retiradosPorOs) {
      // Dois motivos diferentes, duas linhas no histórico: o que passou para outro serviço e o que saiu do cronograma
      const cedidos = rets.filter((x) => x.substituidoPor), fora = rets.length - cedidos.length;
      if (cedidos.length) await historico(osId, "Equipamento retirado pelo cronograma do PMOC", `Plano ${c.nome}: ${cedidos.length} equipamento(s) retirado(s) (nesta competência, atendido(s) por ${servicos(cedidos)}).`);
      if (fora) await historico(osId, "Equipamento retirado pelo cronograma do PMOC", `Plano ${c.nome}: ${fora} equipamento(s) retirado(s) (inativo ou fora do cronograma).`);
    }
    return r;
  }, { timeout: 120_000, maxWait: 20_000 });
}

/* ───────── leitura para a aba ───────── */

export interface ItemCronogramaTela extends ItemCronograma {
  tipoOs: { id: string; nome: string; ativo: boolean };
  tipoEquipamento: { id: string; nome: string } | null;
  equipamento: { id: string; nome: string | null; marca: string; modelo: string; patrimonio: string | null; ativo: boolean } | null;
  /** Equipamentos ativos do plano que entram neste item */
  equipamentos: number;
  /** Próxima execução em que o item de fato gera OS ("AAAA-MM-DD"), já contando a substituição; null = nenhuma */
  proxima: string | null;
  /** Execuções futuras (equipamento × competência) que este item cede a um item de maior intervalo */
  substituidas: number;
}
export interface OsDoCronograma {
  id: string; numero: string; status: string;
  /** Instante agendado (ISO) */
  data: string | null;
  periodo: string; itemId: string; tipoOs: string; local: string | null; equipamentos: number;
  /** Ainda não começou (o reagendamento pode mexer) */
  pendente: boolean;
}
export interface CronogramaTela {
  itens: ItemCronogramaTela[];
  /** Ids dos equipamentos ativos do plano fora de todos os itens */
  semCronograma: string[];
  /** OS geradas: as que ainda vão acontecer primeiro (por data), depois as passadas (da mais nova) */
  ordens: OsDoCronograma[];
  totais: { futuras: number; passadas: number };
  motivo: MotivoSemGerar | null;
  /** O que "Reagendar atividades" faria agora */
  previa: ResumoPlano;
  /** O que o formulário do item oferece (só o que é desta empresa e deste plano) */
  opcoes: OpcoesCronograma;
}
export interface OpcoesCronograma {
  tiposOs: { id: string; nome: string }[];
  /** Tipos que têm pelo menos um equipamento ativo no plano */
  tiposEquipamento: { id: string; nome: string; equipamentos: number }[];
  /** Equipamentos ativos do plano */
  equipamentos: { id: string; rotulo: string; local: string | null }[];
}

const MAX_OS_NA_TELA = 200;

export async function lerCronograma(pmocId: string, empresaId: string, agora: Date = new Date()): Promise<CronogramaTela | null> {
  const c = await carregarCronograma(prisma, pmocId, empresaId);
  if (!c) return null;
  const hoje = hojeISO(agora);
  // O que cada item gera de hoje em diante, já com a substituição (o mesmo cálculo do plano)
  const { desejado, substituidas } = execucoesDesejadas(c.estado, agora);
  const proximaDoItem = new Map<string, string>();
  for (const q of desejado.values()) {
    const dia = chaveDiaBR(q.data);
    if (dia >= hoje && dia < (proximaDoItem.get(q.item.id) ?? "9999")) proximaDoItem.set(q.item.id, dia);
  }
  const cedidasDoItem = new Map<string, number>();
  for (const q of substituidas) if (chaveDiaBR(q.data) >= hoje) cedidasDoItem.set(q.item.id, (cedidasDoItem.get(q.item.id) ?? 0) + 1);
  const itens: ItemCronogramaTela[] = c.linhas.filter((l) => l.ativo).map((l) => {
    const item = c.estado.itens.find((i) => i.id === l.id)!;
    return {
      ...item, tipoOs: l.tipoOs, tipoEquipamento: l.tipoEquipamento, equipamento: l.equipamento,
      equipamentos: c.estado.equipamentos.filter((e) => e.ativo && equipamentoNoItem(item, e, c.estado.tipos)).length,
      proxima: proximaDoItem.get(item.id) ?? null, substituidas: cedidasDoItem.get(item.id) ?? 0,
    };
  });

  // OS geradas: agrupa as execuções por OS
  const porOs = new Map<string, { x: ExecucaoExistente; n: number; pendente: boolean }>();
  for (const x of c.estado.execucoes) {
    if (!x.os) continue;
    const atual = porOs.get(x.os.id);
    const pendente = execucaoPendente(x, hoje);
    if (atual) { atual.n++; atual.pendente = atual.pendente || pendente; } else porOs.set(x.os.id, { x, n: 1, pendente });
  }
  const locais = porOs.size
    ? new Map((await prisma.ordemServico.findMany({ where: { id: { in: [...porOs.keys()] } }, select: { id: true, unidade: { select: { nome: true } } } })).map((o) => [o.id, o.unidade?.nome ?? null]))
    : new Map<string, string | null>();
  const todas: OsDoCronograma[] = [...porOs.values()].map(({ x, n, pendente }) => ({
    id: x.os!.id, numero: x.os!.numero, status: x.os!.status, data: x.os!.dataAgendada, periodo: x.periodo, itemId: x.cronogramaId,
    tipoOs: c.tipoOsNome.get(c.estado.itens.find((i) => i.id === x.cronogramaId)?.tipoOsId ?? "") ?? "", local: locais.get(x.os!.id) ?? null, equipamentos: n, pendente,
  }));
  const dia = (o: OsDoCronograma) => (o.data ? chaveDiaBR(o.data) : "");
  const futuras = todas.filter((o) => dia(o) >= hoje).sort((a, b) => dia(a).localeCompare(dia(b)) || a.numero.localeCompare(b.numero));
  const passadas = todas.filter((o) => dia(o) < hoje).sort((a, b) => dia(b).localeCompare(dia(a)) || a.numero.localeCompare(b.numero));
  const plano = planejarCronograma(c.estado, agora);
  const [tiposOs, tiposEquip, doPlano] = await Promise.all([
    prisma.tipoOs.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.tipoEquipamentoCustom.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, chaveEnum: true }, orderBy: { nome: "asc" } }),
    prisma.pmocEquipamento.findMany({
      where: { pmocId, equipamento: { ativo: true } }, orderBy: { criadoEm: "asc" },
      select: { equipamento: { select: { id: true, nome: true, marca: true, modelo: true, patrimonio: true, unidade: { select: { nome: true } } } } },
    }),
  ]);
  const ativos = c.estado.equipamentos.filter((e) => e.ativo);
  const opcoes: OpcoesCronograma = {
    tiposOs,
    tiposEquipamento: tiposEquip
      .map((t) => ({ id: t.id, nome: t.nome, equipamentos: ativos.filter((e) => equipamentoNoItem({ tipoEquipamentoId: t.id, equipamentoId: null }, e, c.estado.tipos)).length }))
      .filter((t) => t.equipamentos > 0),
    equipamentos: doPlano.map(({ equipamento: e }) => ({
      id: e.id, rotulo: [e.patrimonio, e.nome || `${e.marca} ${e.modelo}`.trim()].filter(Boolean).join(" · "), local: e.unidade?.nome ?? null,
    })),
  };
  return {
    opcoes, itens, semCronograma: equipamentosSemCronograma(c.estado.itens, c.estado.equipamentos, c.estado.tipos),
    ordens: [...futuras, ...passadas].slice(0, MAX_OS_NA_TELA), totais: { futuras: futuras.length, passadas: passadas.length },
    motivo: plano.motivo, previa: resumirPlano(plano),
  };
}

/** OS futuras, ainda não iniciadas, geradas pelo cronograma do plano (para o aviso de inativar o plano) */
export async function osFuturasDoPlano(pmocId: string, empresaId: string, agora: Date = new Date()): Promise<number> {
  const c = await carregarCronograma(prisma, pmocId, empresaId);
  if (!c) return 0;
  const hoje = hojeISO(agora);
  return new Set(c.estado.execucoes.filter((x) => execucaoPendente(x, hoje)).map((x) => x.os!.id)).size;
}
