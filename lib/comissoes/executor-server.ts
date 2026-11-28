/**
 * COM-2 — a comissão do EXECUTOR no servidor: gerar (pela OS), sincronizar (liberar/estornar), revisar retorno.
 *
 * Como na COM-1, nada é empurrado pela operação: a conta é REFEITA a partir do estado real da OS sempre que alguém
 * olha (o extrato do técnico, o fechamento do mês, o app). Refazer é idempotente:
 *  - a comissão de cada unidade (equipamento atendido × linha × pessoa) nasce quando a unidade PASSA na trava de
 *    qualidade (equipamento feito + relatório completo) e fica congelada (regra, parte, valor, quando);
 *  - a que deixou de passar e nada liberou some; a que já tinha algo liberado leva estorno;
 *  - o lançamento é só a diferença até o alvo do gatilho (e a empresa fica travada durante a conta);
 *  - retorno no mesmo equipamento abre uma revisão (uma por comissão × OS do retorno).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { relatoriosDasAtividades } from "@/lib/desempenho/medicao-server";
import { descricaoDaRegra, fracaoRecebida, liberacaoPorMes, movimentoNecessario, round2, type QuandoExecutor } from "./regras";
import {
  MOTIVO_EXECUTOR, alvoDoExecutor, chaveDoExecutor, comissoesDaUnidade, ehOrigemDoRetorno, motivoDoEstornoExecutor, piorRevisao, unidadesDaOs,
  type Atendido, type LinhaOs, type Participante,
} from "./executor";
import { recebimentoDaOrigem, regrasAtivas } from "./servidor";
import type { ComissaoRetrato } from "@/lib/tecnico/comissao";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DIA_MS = 86_400_000;
/** OS sem comissão ainda só entra na conta se mexeu nos últimos dias (a de 6 meses atrás não muda mais) */
export const JANELA_GERACAO_DIAS = 180;

/** A unidade (atividade × equipamento × linha), sem a pessoa: o que a trava de qualidade olha */
const chaveDaUnidade = (u: { atividadeId: string | null; equipamentoId: string | null; linhaId: string }) => `${u.atividadeId ?? "-"}:${u.equipamentoId ?? "-"}:${u.linhaId}`;

const travarEmpresa = (tx: Prisma.TransactionClient, empresaId: string) => tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`comissoes:${empresaId}`}))`;

/** Prefixo do "usuário" de quem não tem login: entra na divisão (a parte dele não vai para os colegas), mas não recebe */
const SEM_LOGIN = "sem-login:";

/**
 * Cada colaborador da atividade como participante da divisão: o usuário (login) pelo e-mail — o mesmo vínculo da
 * COM-1, ao contrário. Quem não tem login entra na conta da divisão com um id que não recebe nada.
 */
async function participantesDosTecnicos(db: Prisma.TransactionClient, empresaId: string, tecnicoIds: string[], incluirInativos = false): Promise<Map<string, Participante>> {
  const r = new Map<string, Participante>();
  if (!tecnicoIds.length) return r;
  const tecnicos = await db.tecnico.findMany({ where: { empresaId, id: { in: tecnicoIds } }, select: { id: true, nome: true, email: true, cargoId: true } });
  const emails = [...new Set(tecnicos.map((t) => (t.email ?? "").trim().toLowerCase()).filter(Boolean))];
  const usuarios = emails.length ? await db.usuario.findMany({ where: { empresaId, ...(incluirInativos ? {} : { ativo: true }), email: { in: emails, mode: "insensitive" } }, select: { id: true, nome: true, email: true } }) : [];
  for (const t of tecnicos) {
    const u = usuarios.find((x) => !!t.email && x.email.trim().toLowerCase() === t.email.trim().toLowerCase());
    r.set(t.id, u ? { usuarioId: u.id, tecnicoId: t.id, cargoId: t.cargoId, nome: u.nome } : { usuarioId: `${SEM_LOGIN}${t.id}`, tecnicoId: t.id, cargoId: t.cargoId, nome: t.nome });
  }
  return r;
}

/** As OS que entram na conta: as do filtro; ou as que já têm comissão do técnico e as que mexeram na janela */
async function osDaConta(db: Prisma.TransactionClient, empresaId: string, filtro: { osIds?: string[]; usuarioId?: string }, agora: Date): Promise<string[]> {
  if (filtro.osIds) return filtro.osIds;
  let tecnicoId: string | null = null;
  if (filtro.usuarioId) {
    const u = await db.usuario.findFirst({ where: { id: filtro.usuarioId, empresaId }, select: { email: true } });
    const t = u ? await db.tecnico.findFirst({ where: { empresaId, ativo: true, email: { equals: u.email.trim(), mode: "insensitive" } }, orderBy: { criadoEm: "asc" }, select: { id: true } }) : null;
    tecnicoId = t?.id ?? null;
  }
  const participa: Prisma.AtividadeOsWhereInput | null = filtro.usuarioId
    ? (tecnicoId ? { OR: [{ tecnicoId }, { tecnicosEquipe: { some: { tecnicoId } } }] } : null)
    : {};
  const [comComissao, recentes] = await Promise.all([
    db.comissao.findMany({ where: { empresaId, ordemServicoId: { not: null }, ...(filtro.usuarioId ? { usuarioId: filtro.usuarioId } : {}) }, select: { ordemServicoId: true }, distinct: ["ordemServicoId"] }),
    participa === null ? Promise.resolve([]) : db.ordemServico.findMany({
      where: { empresaId, status: { not: "CANCELADA" }, atualizadoEm: { gte: new Date(agora.getTime() - JANELA_GERACAO_DIAS * DIA_MS) }, atividades: { some: { status: { not: "CANCELADA" }, ...participa } } },
      select: { id: true },
    }),
  ]);
  return [...new Set([...comComissao.map((c) => c.ordemServicoId!), ...recentes.map((o) => o.id)])];
}

export interface ResultadoExecutor { criadas: number; removidas: number; lancamentos: number; revisoes: number }

/**
 * Refaz as comissões do técnico das OS (todas as da conta, as do filtro, ou as de uma pessoa): gera as que passaram
 * na trava, tira as que deixaram de passar (sem nada liberado), abre a revisão do retorno e lança a diferença até o
 * alvo de cada uma. Sem regra de Executor e sem comissão do técnico na empresa, não faz nada.
 */
export async function sincronizarExecutor(empresaId: string, filtro: { osIds?: string[]; usuarioId?: string } = {}, agora: Date = new Date()): Promise<ResultadoExecutor> {
  const vazio: ResultadoExecutor = { criadas: 0, removidas: 0, lancamentos: 0, revisoes: 0 };
  const regras = (await regrasAtivas(empresaId)).filter((r) => r.papel === "EXECUTOR");
  if (!regras.length && !(await prisma.comissao.count({ where: { empresaId, ordemServicoId: { not: null } } }))) return vazio;
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { comissaoExecutorQuando: true, comissaoLiquidaImpostos: true, comissaoRetornoDias: true } });
  const quandoHoje = (cfg?.comissaoExecutorQuando ?? "CONCLUSAO_OS") as QuandoExecutor;
  const liquida = cfg?.comissaoLiquidaImpostos ?? false;
  const dias = cfg?.comissaoRetornoDias ?? 30;
  // Os nomes da regra como eram (a descrição fica congelada na comissão)
  const [nomesU, nomesC, nomesS] = await Promise.all([
    prisma.usuario.findMany({ where: { empresaId, id: { in: regras.map((r) => r.usuarioId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
    prisma.cargo.findMany({ where: { empresaId, id: { in: regras.map((r) => r.cargoId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
    prisma.servico.findMany({ where: { empresaId, id: { in: regras.map((r) => r.servicoId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
  ]);
  const nome = (l: { id: string; nome: string }[], id?: string | null) => l.find((x) => x.id === id)?.nome ?? null;

  return prisma.$transaction(async (tx) => {
    await travarEmpresa(tx, empresaId);
    const r = { ...vazio };
    for (const osId of await osDaConta(tx, empresaId, filtro, agora)) {
      const feito = await sincronizarOs(tx, { empresaId, osId, regras, quandoHoje, liquida, dias, agora, nomeRegra: (rg) => descricaoDaRegra(rg, { pessoa: nome(nomesU, rg.usuarioId), cargo: nome(nomesC, rg.cargoId), servico: nome(nomesS, rg.servicoId) }) });
      r.criadas += feito.criadas; r.removidas += feito.removidas; r.lancamentos += feito.lancamentos; r.revisoes += feito.revisoes;
    }
    return r;
  }, { timeout: 120_000 });
}

interface CtxOs {
  empresaId: string; osId: string; regras: Awaited<ReturnType<typeof regrasAtivas>>; quandoHoje: QuandoExecutor; liquida: boolean; dias: number; agora: Date;
  nomeRegra: (r: Awaited<ReturnType<typeof regrasAtivas>>[number]) => string;
}

async function sincronizarOs(tx: Prisma.TransactionClient, c: CtxOs): Promise<ResultadoExecutor> {
  const r: ResultadoExecutor = { criadas: 0, removidas: 0, lancamentos: 0, revisoes: 0 };
  const os = await tx.ordemServico.findFirst({
    where: { id: c.osId, empresaId: c.empresaId },
    select: {
      id: true, numero: true, status: true, dataConclusao: true, equipamentoId: true,
      aceite: { select: { situacao: true, confirmadoEm: true } },
      itensOrcamento: {
        orderBy: { ordem: "asc" },
        select: {
          id: true, tipo: true, servicoId: true, descricao: true, quantidade: true, valorTotal: true,
          servico: { select: { categoria: true } },
          materiais: { select: { custoUnit: true, quantidade: true, comportamento: true } },
          material: { select: { custoUnit: true } },
        },
      },
      atividades: {
        where: { status: { not: "CANCELADA" } },
        select: {
          id: true, tipoOsId: true, status: true, concluidaEm: true, tecnicoId: true, tecnicosEquipe: { select: { tecnicoId: true } },
          equipamentos: { select: { equipamentoId: true, feito: true, feitoEm: true, feitoPorId: true } },
        },
      },
    },
  });
  if (!os) return r;
  const viva = os.status !== "CANCELADA";

  /* 1. o que DEVERIA existir (só com a OS viva) */
  const desejadas = new Map<string, Prisma.ComissaoCreateManyInput>();
  // PJ4: a trava de qualidade é da UNIDADE (serviço feito + relatório completo) e da pessoa ainda estar na atividade.
  // Não depende de a regra continuar ativa, do login continuar ativo nem do cargo: a comissão já nascida é congelada.
  const naAtividade = new Set<string>();
  if (viva) {
    const linhas: LinhaOs[] = os.itensOrcamento.map((l) => {
      const inclusos = l.materiais.filter((m) => m.comportamento === "INCLUSO_NO_SERVICO");
      const custo = l.tipo === "PRODUTO"
        ? (l.material?.custoUnit == null ? null : round2(num(l.material.custoUnit) * num(l.quantidade)))
        : inclusos.some((m) => m.custoUnit == null) ? null : round2(inclusos.reduce((s, m) => s + num(m.custoUnit) * num(m.quantidade), 0));
      return { id: l.id, tipo: l.tipo === "PRODUTO" ? "PRODUTO" : "SERVICO", servicoId: l.servicoId, categoria: l.servico?.categoria ?? null, descricao: l.descricao, quantidade: l.quantidade, valorTotal: l.valorTotal, custo };
    });
    const vinculados = new Set([os.equipamentoId, ...os.atividades.flatMap((a) => a.equipamentos.map((e) => e.equipamentoId))].filter(Boolean) as string[]);
    // O equipamento atendido em mais de uma atividade conta UMA vez: a última em que foi feito
    const ultimo = new Map<string, { atividadeId: string; feitoEm: Date; feitoPorId: string | null }>();
    for (const a of os.atividades) for (const e of a.equipamentos) {
      if (!e.feito) continue;
      const t = e.feitoEm ?? new Date(0);
      const ja = ultimo.get(e.equipamentoId);
      if (!ja || t > ja.feitoEm) ultimo.set(e.equipamentoId, { atividadeId: a.id, feitoEm: t, feitoPorId: e.feitoPorId });
    }
    // A trava de qualidade: o relatório do equipamento completo (a mesma regra que libera a conclusão no app)
    const atividadesComFeito = os.atividades.filter((a) => [...ultimo.values()].some((u) => u.atividadeId === a.id));
    const relatorios = atividadesComFeito.length
      ? await relatoriosDasAtividades(c.empresaId, atividadesComFeito.map((a) => ({ id: a.id, tipoOsId: a.tipoOsId, concluidaEm: a.concluidaEm ?? c.agora })))
      : new Map();
    const completo = (atividadeId: string, equipamentoId: string) => (relatorios.get(atividadeId) ?? []).some((x: { equipamentoId: string; completo: boolean }) => x.equipamentoId === equipamentoId && x.completo);
    const atendidos: Atendido[] = [...ultimo.entries()]
      .filter(([eq, u]) => completo(u.atividadeId, eq))
      .map(([equipamentoId, u]) => ({ atividadeId: u.atividadeId, equipamentoId, feitoPorTecnicoId: u.feitoPorId }));
    // OS sem equipamento: a linha vale com a OS concluída, para os técnicos de todas as atividades
    const semEquipamento = vinculados.size === 0;
    const unidades = semEquipamento ? (os.status === "CONCLUIDA" ? unidadesDaOs(linhas, 0, []) : []) : unidadesDaOs(linhas, vinculados.size, atendidos);
    const tecnicosDe = (a: (typeof os.atividades)[number]) => [a.tecnicoId, ...a.tecnicosEquipe.map((t) => t.tecnicoId)].filter((x): x is string => !!x);
    const pessoas = await participantesDosTecnicos(tx, c.empresaId, [...new Set(os.atividades.flatMap(tecnicosDe))]);
    const participantesDe = (atividadeId: string | null): Participante[] => {
      const ids = atividadeId ? tecnicosDe(os.atividades.find((a) => a.id === atividadeId)!) : os.atividades.flatMap(tecnicosDe);
      const vistos = new Set<string>();
      return ids.map((id) => pessoas.get(id)).filter((p): p is Participante => !!p && !vistos.has(p.usuarioId) && !!vistos.add(p.usuarioId));
    };
    const todos = await participantesDosTecnicos(tx, c.empresaId, [...new Set(os.atividades.flatMap(tecnicosDe))], true);
    for (const u of unidades) {
      const ids = u.atividadeId ? tecnicosDe(os.atividades.find((a) => a.id === u.atividadeId)!) : os.atividades.flatMap(tecnicosDe);
      for (const id of ids) { const p = todos.get(id); if (p) naAtividade.add(`${chaveDaUnidade(u)}|${p.usuarioId}`); }
    }
    if (c.regras.length) for (const u of unidades) {
      for (const k of comissoesDaUnidade(u, participantesDe(u.atividadeId), c.regras, c.liquida)) {
        if (k.participante.usuarioId.startsWith(SEM_LOGIN)) continue; // sem login não recebe (e a parte dele não muda de dono)
        const chave = chaveDoExecutor(os.id, u, k.participante.usuarioId);
        desejadas.set(chave, {
          empresaId: c.empresaId, orcamentoId: null, ordemServicoId: os.id, atividadeId: u.atividadeId, equipamentoId: u.equipamentoId, chave,
          usuarioId: k.participante.usuarioId, beneficiarioNome: k.participante.nome, papel: "EXECUTOR",
          itemTipo: u.item.tipo, itemId: u.linhaId, descricao: u.item.descricao, quantidade: u.item.quantidade,
          regraId: k.regra.id, regraDescricao: c.nomeRegra(k.regra), base: k.regra.base, baseValor: k.baseValor, taxa: k.taxa, valor: k.valor,
          parte: k.parte, divisao: k.divisao, quando: c.quandoHoje, liquidaImpostos: c.liquida, criadoEm: c.agora,
        });
      }
    }
  }

  /* 2. o que existe: cria o que falta, tira o que deixou de valer sem nada liberado */
  const existentes = await tx.comissao.findMany({
    where: { empresaId: c.empresaId, ordemServicoId: os.id },
    select: { id: true, chave: true, usuarioId: true, valor: true, quando: true, atividadeId: true, equipamentoId: true, lancamentos: { select: { valor: true } }, revisoes: { select: { situacao: true } } },
  });
  const novas = [...desejadas.entries()].filter(([k]) => !existentes.some((e) => e.chave === k)).map(([, v]) => v);
  if (novas.length) r.criadas = (await tx.comissao.createMany({ data: novas, skipDuplicates: true })).count;
  const semValer = existentes.filter((e) => !e.chave || !desejadas.has(e.chave));
  const apagar = semValer.filter((e) => !e.lancamentos.length).map((e) => e.id);
  if (apagar.length) r.removidas = (await tx.comissao.deleteMany({ where: { id: { in: apagar } } })).count;

  const vivas = await tx.comissao.findMany({
    where: { empresaId: c.empresaId, ordemServicoId: os.id },
    select: { id: true, chave: true, usuarioId: true, valor: true, quando: true, atividadeId: true, equipamentoId: true, itemId: true, lancamentos: { select: { valor: true } } },
  });
  if (!vivas.length) return r;

  /* 3. o retorno no mesmo equipamento: abre a revisão */
  if (c.dias > 0) r.revisoes = await abrirRevisoes(tx, c, os, vivas);
  const revisoes = await tx.comissaoRevisao.findMany({ where: { comissaoId: { in: vivas.map((v) => v.id) } }, select: { comissaoId: true, situacao: true } });

  /* 4. leva cada uma ao alvo do gatilho */
  const precisaRecebido = vivas.some((v) => v.quando === "RECEBIMENTO");
  const rec = precisaRecebido ? await recebimentoDaOrigem(tx, c.empresaId, { osId: os.id }) : { faturas: [], ultimaData: null, entradas: [] };
  const totalOs = os.itensOrcamento.reduce((s, l) => s + num(l.valorTotal), 0);
  const aceite = os.aceite?.situacao === "CONFIRMADO";
  const novos: Prisma.ComissaoLancamentoCreateManyInput[] = [];
  for (const v of vivas) {
    const estado = {
      osViva: viva, qualidade: !!v.chave && (desejadas.has(v.chave) || naAtividade.has(`${chaveDaUnidade({ atividadeId: v.atividadeId, equipamentoId: v.equipamentoId, linhaId: v.itemId ?? "" })}|${v.usuarioId}`)), osConcluida: os.status === "CONCLUIDA", aceite,
      fracao: fracaoRecebida(rec.faturas, totalOs), revisao: piorRevisao(revisoes.filter((x) => x.comissaoId === v.id).map((x) => x.situacao)),
    };
    const quando = v.quando as QuandoExecutor;
    const ja = round2(v.lancamentos.reduce((s, l) => s + num(l.valor), 0));
    const mov = movimentoNecessario(alvoDoExecutor({ valor: num(v.valor), quando }, estado, ja), ja);
    if (!mov) continue;
    // PJ4: a liberação por recebimento vai para o mês em que cada parte do dinheiro entrou
    if (mov.tipo === "LIBERACAO" && quando === "RECEBIMENTO") {
      for (const p of liberacaoPorMes({ valorComissao: num(v.valor), totalVenda: totalOs, jaLiberado: ja, valor: mov.valor, entradas: rec.entradas, reserva: rec.ultimaData ?? c.agora }))
        novos.push({ empresaId: c.empresaId, comissaoId: v.id, usuarioId: v.usuarioId, tipo: mov.tipo, valor: p.valor, data: p.data, motivo: MOTIVO_EXECUTOR[quando] });
      continue;
    }
    const data = mov.tipo === "ESTORNO" ? c.agora
      : quando === "CONCLUSAO_OS" ? os.dataConclusao ?? c.agora
      : quando === "ACEITE" ? os.aceite?.confirmadoEm ?? c.agora
      : rec.ultimaData ?? c.agora;
    novos.push({
      empresaId: c.empresaId, comissaoId: v.id, usuarioId: v.usuarioId, tipo: mov.tipo, valor: mov.valor, data,
      motivo: mov.tipo === "ESTORNO" ? motivoDoEstornoExecutor(estado) : MOTIVO_EXECUTOR[quando],
    });
  }
  if (novos.length) r.lancamentos = (await tx.comissaoLancamento.createMany({ data: novos })).count;
  return r;
}

/**
 * Retorno: outra OS no MESMO equipamento, aberta até N dias depois do serviço, que "volta" deste serviço (o último
 * antes dela). Fica de fora o que é serviço previsto (OS de orçamento ou de ocorrência do PMOC), e o técnico que
 * REGISTROU o problema no serviço (Atenção no checklist, ocorrência ou serviço adicional) — como no Desempenho.
 * Só contam as OS dos TIPOS DE RETORNO (a mesma lista do Desempenho, editável também em Configurações › Comissões):
 * sem nenhum tipo marcado, a revisão de retorno fica desligada. Uma revisão por comissão × OS do retorno.
 */
async function abrirRevisoes(
  tx: Prisma.TransactionClient, c: CtxOs, os: { id: string; numero: string },
  vivas: { id: string; atividadeId: string | null; equipamentoId: string | null }[],
): Promise<number> {
  const comEquip = vivas.filter((v) => v.atividadeId && v.equipamentoId);
  if (!comEquip.length) return 0;
  const equipIds = [...new Set(comEquip.map((v) => v.equipamentoId!))];
  const atividadeIds = [...new Set(comEquip.map((v) => v.atividadeId!))];
  const servicos = await tx.atividadeEquipamento.findMany({
    where: { equipamentoId: { in: equipIds }, feito: true, atividade: { empresaId: c.empresaId, status: { not: "CANCELADA" }, ordemServico: { status: { not: "CANCELADA" } } } },
    select: { equipamentoId: true, atividadeId: true, feitoEm: true, atividade: { select: { ordemServicoId: true } }, equipamento: { select: { nome: true, marca: true, modelo: true } } },
  });
  const deste = servicos.filter((s) => atividadeIds.includes(s.atividadeId) && s.atividade.ordemServicoId === os.id && s.feitoEm);
  if (!deste.length) return 0;
  const primeiro = Math.min(...deste.map((s) => s.feitoEm!.getTime()));
  // Sem tipo marcado, `in: []` não acha nenhuma OS: a revisão fica desligada
  const tiposRetorno = (await tx.desempenhoTipoRetorno.findMany({ where: { empresaId: c.empresaId }, select: { tipoOsId: true } })).map((t) => t.tipoOsId);
  const candidatas = await tx.ordemServico.findMany({
    where: {
      empresaId: c.empresaId, id: { not: os.id }, status: { not: "CANCELADA" }, orcamentoOrigemId: null, pmocOcorrenciasCorretivas: { none: {} },
      criadoEm: { gt: new Date(primeiro), lte: new Date(c.agora.getTime()) },
      OR: [{ equipamentoId: { in: equipIds } }, { atividades: { some: { status: { not: "CANCELADA" }, equipamentos: { some: { equipamentoId: { in: equipIds } } } } } }],
      atividades: { some: { tipoOsId: { in: tiposRetorno }, status: { not: "CANCELADA" } } },
    },
    select: { id: true, numero: true, criadoEm: true, equipamentoId: true, atividades: { where: { status: { not: "CANCELADA" } }, select: { equipamentos: { select: { equipamentoId: true } } } } },
  });
  if (!candidatas.length) return 0;
  const [atencoes, ocorrencias, adicionais] = await Promise.all([
    tx.checklistResposta.findMany({ where: { atividadeId: { in: atividadeIds }, status: "ATENCAO" }, select: { atividadeId: true, equipamentoId: true } }),
    tx.pmocOcorrencia.findMany({ where: { empresaId: c.empresaId, ativo: true, OR: [{ atividadeId: { in: atividadeIds } }, { ordemServicoId: os.id }] }, select: { atividadeId: true, ordemServicoId: true, equipamentoId: true } }),
    tx.servicoAdicional.findMany({ where: { empresaId: c.empresaId, atividadeId: { in: atividadeIds } }, select: { atividadeId: true, equipamentoId: true } }),
  ]);
  const registrou = (atividadeId: string, equipamentoId: string) => {
    const doEquip = (x: { equipamentoId: string | null }) => !x.equipamentoId || x.equipamentoId === equipamentoId;
    return atencoes.some((a) => a.atividadeId === atividadeId && a.equipamentoId === equipamentoId)
      || ocorrencias.some((o) => (o.atividadeId === atividadeId || o.ordemServicoId === os.id) && doEquip(o))
      || adicionais.some((s) => s.atividadeId === atividadeId && doEquip(s));
  };
  const novas: Prisma.ComissaoRevisaoCreateManyInput[] = [];
  for (const v of comEquip) {
    const eq = v.equipamentoId!;
    const servico = deste.find((s) => s.atividadeId === v.atividadeId && s.equipamentoId === eq);
    if (!servico || registrou(v.atividadeId!, eq)) continue;
    const noEquip = servicos.filter((s) => s.equipamentoId === eq && s.feitoEm).map((s) => ({ atividadeId: s.atividadeId, ordemServicoId: s.atividade.ordemServicoId, feitoEm: s.feitoEm! }));
    for (const ret of candidatas) {
      const tocaEquip = ret.equipamentoId === eq || ret.atividades.some((a) => a.equipamentos.some((e) => e.equipamentoId === eq));
      if (!tocaEquip || !ehOrigemDoRetorno(noEquip, { ordemServicoId: ret.id, abertaEm: ret.criadoEm }, c.dias, { atividadeId: v.atividadeId! })) continue;
      const dias = Math.max(0, Math.round((ret.criadoEm.getTime() - servico.feitoEm!.getTime()) / DIA_MS));
      const equip = [servico.equipamento.nome, servico.equipamento.marca, servico.equipamento.modelo].filter(Boolean).join(" ") || "equipamento";
      novas.push({
        empresaId: c.empresaId, comissaoId: v.id, osRetornoId: ret.id, equipamentoId: eq,
        descricao: `${ret.numero} aberta ${dias === 1 ? "1 dia" : `${dias} dias`} depois do serviço da ${os.numero} em ${equip}`.slice(0, 300),
      });
    }
  }
  if (!novas.length) return 0;
  return (await tx.comissaoRevisao.createMany({ data: novas, skipDuplicates: true })).count;
}

/* ───────── o teto (Configurações › Comissões) ───────── */

export const MSG_TETO_REPETIDO = "Já existe um teto para esta pessoa/cargo. Edite o que existe.";
export const MSG_TETO_REFERENCIA = "Pessoa ou cargo não encontrado nesta empresa.";

export async function tetosDaEmpresa(empresaId: string) {
  const ts = await prisma.comissaoTeto.findMany({
    where: { empresaId }, orderBy: [{ quemTipo: "desc" }, { criadoEm: "asc" }],
    select: { id: true, quemTipo: true, usuarioId: true, cargoId: true, valor: true, ativo: true, usuario: { select: { nome: true } }, cargo: { select: { nome: true } } },
  });
  return ts.map((t) => ({ id: t.id, quemTipo: t.quemTipo as "PESSOA" | "CARGO", usuarioId: t.usuarioId, cargoId: t.cargoId, valor: num(t.valor), ativo: t.ativo, nome: t.usuario?.nome ?? t.cargo?.nome ?? "—" }));
}

/** Cria ou edita um teto: a pessoa/o cargo precisa ser da empresa e não pode haver dois tetos para o mesmo alvo. */
export async function salvarTeto(empresaId: string, d: { quemTipo: "PESSOA" | "CARGO"; usuarioId?: string | null; cargoId?: string | null; valor: number; ativo?: boolean }, id?: string):
  Promise<{ ok: true; id: string } | { ok: false; status: number; erro: string }> {
  if (id && !(await prisma.comissaoTeto.findFirst({ where: { id, empresaId }, select: { id: true } }))) return { ok: false, status: 404, erro: "Teto não encontrado" };
  const dados = { quemTipo: d.quemTipo, usuarioId: d.quemTipo === "PESSOA" ? d.usuarioId ?? null : null, cargoId: d.quemTipo === "CARGO" ? d.cargoId ?? null : null, valor: round2(d.valor), ativo: d.ativo ?? true };
  const existe = dados.usuarioId ? await prisma.usuario.count({ where: { id: dados.usuarioId, empresaId } }) : await prisma.cargo.count({ where: { id: dados.cargoId ?? "", empresaId } });
  if (!existe) return { ok: false, status: 400, erro: MSG_TETO_REFERENCIA };
  const repetido = await prisma.comissaoTeto.count({ where: { empresaId, quemTipo: dados.quemTipo, usuarioId: dados.usuarioId, cargoId: dados.cargoId, ...(id ? { id: { not: id } } : {}) } });
  if (repetido) return { ok: false, status: 409, erro: MSG_TETO_REPETIDO };
  if (id) { await prisma.comissaoTeto.update({ where: { id }, data: dados }); return { ok: true, id }; }
  const t = await prisma.comissaoTeto.create({ data: { ...dados, empresaId }, select: { id: true } });
  return { ok: true, id: t.id };
}

export async function excluirTeto(empresaId: string, id: string): Promise<boolean> {
  return (await prisma.comissaoTeto.deleteMany({ where: { id, empresaId } })).count > 0;
}

/* ───────── a revisão do retorno (Desempenho › Fechamento) ───────── */

export interface RevisaoNaTela {
  id: string; situacao: "A_REVISAR" | "ESTORNAR" | "MANTER"; descricao: string; beneficiario: string; usuarioId: string | null;
  osNumero: string; valor: number; motivo: string | null; decididoPorNome: string | null; decididoEm: string | null; criadoEm: string;
}

/** As revisões da empresa: as abertas primeiro, depois as últimas decididas (as 30 mais recentes) */
export async function revisoesDaEmpresa(empresaId: string): Promise<RevisaoNaTela[]> {
  const sel = {
    id: true, situacao: true, descricao: true, motivo: true, decididoPorNome: true, decididoEm: true, criadoEm: true,
    comissao: { select: { beneficiarioNome: true, usuarioId: true, valor: true, ordemServico: { select: { numero: true, chamadoNumero: true } } } },
  } as const;
  const [abertas, decididas] = await Promise.all([
    prisma.comissaoRevisao.findMany({ where: { empresaId, situacao: "A_REVISAR" }, orderBy: { criadoEm: "asc" }, select: sel }),
    prisma.comissaoRevisao.findMany({ where: { empresaId, situacao: { not: "A_REVISAR" } }, orderBy: { decididoEm: "desc" }, take: 30, select: sel }),
  ]);
  return [...abertas, ...decididas].map((r) => ({
    id: r.id, situacao: r.situacao as RevisaoNaTela["situacao"], descricao: r.descricao, beneficiario: r.comissao.beneficiarioNome, usuarioId: r.comissao.usuarioId,
    osNumero: r.comissao.ordemServico?.chamadoNumero ?? r.comissao.ordemServico?.numero ?? "", valor: num(r.comissao.valor), motivo: r.motivo,
    decididoPorNome: r.decididoPorNome, decididoEm: r.decididoEm?.toISOString() ?? null, criadoEm: r.criadoEm.toISOString(),
  }));
}

/**
 * O encarregado decide: ESTORNAR (o retorno conta: a comissão vai a zero, o que já foi pago desconta no mês seguinte)
 * ou MANTER (libera normalmente). Com motivo; ninguém decide a própria; decidida não muda de novo. A conta da OS é
 * refeita na hora.
 */
export async function decidirRevisao(empresaId: string, id: string, d: { decisao: "ESTORNAR" | "MANTER"; motivo: string }, autor: { usuarioId: string; nome: string }, agora: Date = new Date()):
  Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const { MSG_REVISAR_PROPRIA, MSG_REVISAO_DECIDIDA } = await import("./executor");
  const r = await prisma.comissaoRevisao.findFirst({ where: { id, empresaId }, select: { id: true, situacao: true, comissao: { select: { usuarioId: true, ordemServicoId: true } } } });
  if (!r) return { ok: false, status: 404, erro: "Revisão não encontrada" };
  if (r.comissao.usuarioId === autor.usuarioId) return { ok: false, status: 403, erro: MSG_REVISAR_PROPRIA };
  const { count } = await prisma.comissaoRevisao.updateMany({
    where: { id, empresaId, situacao: "A_REVISAR" },
    data: { situacao: d.decisao, motivo: d.motivo.trim(), decididoPorId: autor.usuarioId, decididoPorNome: autor.nome, decididoEm: agora },
  });
  if (!count) return { ok: false, status: 409, erro: MSG_REVISAO_DECIDIDA };
  if (r.comissao.ordemServicoId) await sincronizarExecutor(empresaId, { osIds: [r.comissao.ordemServicoId] }, agora);
  return { ok: true };
}

/** Quantas revisões estão abertas (o aviso do fechamento e o sino) */
export const revisoesAbertas = (empresaId: string) => prisma.comissaoRevisao.count({ where: { empresaId, situacao: "A_REVISAR" } });

/* ───────── COM-2B: o que o app do técnico recebe (no retrato da atividade) ───────── */

// O formato é do app (lib/tecnico/comissao): o servidor só preenche
export type { ComissaoRetrato };

/**
 * A comissão do técnico logado nesta atividade, para o app mostrar AO VIVO (também sem sinal): a mesma conta do
 * servidor (unidade, regra que vence para ele, divisão), supondo cada equipamento da atividade feito e completo.
 * Só o valor dele — nenhuma regra, base, custo ou valor de colega vai para o aparelho. null = a empresa não paga
 * técnico, a OS foi cancelada, a pessoa não está na atividade ou a OS não tem equipamento.
 */
export async function comissaoParaRetrato(empresaId: string, atividadeId: string, usuarioId: string): Promise<ComissaoRetrato | null> {
  const regras = (await regrasAtivas(empresaId)).filter((r) => r.papel === "EXECUTOR");
  if (!regras.length) return null;
  const a = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, empresaId, status: { not: "CANCELADA" }, ordemServico: { status: { not: "CANCELADA" } } },
    select: {
      id: true, ordemServicoId: true, tecnicoId: true, tecnicosEquipe: { select: { tecnicoId: true } }, equipamentos: { select: { equipamentoId: true, feito: true, feitoPorId: true } },
      ordemServico: {
        select: {
          equipamentoId: true,
          atividades: { where: { status: { not: "CANCELADA" } }, select: { equipamentos: { select: { equipamentoId: true } } } },
          itensOrcamento: { select: { id: true, tipo: true, servicoId: true, descricao: true, quantidade: true, valorTotal: true, servico: { select: { categoria: true } }, materiais: { select: { custoUnit: true, quantidade: true, comportamento: true } }, material: { select: { custoUnit: true } } } },
        },
      },
    },
  });
  if (!a || !a.equipamentos.length) return null;
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { comissaoLiquidaImpostos: true } });
  const tecnicoIds = [...new Set([a.tecnicoId, ...a.tecnicosEquipe.map((t) => t.tecnicoId)].filter((x): x is string => !!x))];
  const pessoas = await prisma.$transaction((tx) => participantesDosTecnicos(tx, empresaId, tecnicoIds));
  const participantes = tecnicoIds.map((id) => pessoas.get(id)).filter((p): p is Participante => !!p);
  const eu = participantes.find((p) => p.usuarioId === usuarioId);
  if (!eu) return null;
  const linhas: LinhaOs[] = a.ordemServico.itensOrcamento.map((l) => {
    const inclusos = l.materiais.filter((m) => m.comportamento === "INCLUSO_NO_SERVICO");
    const custo = l.tipo === "PRODUTO"
      ? (l.material?.custoUnit == null ? null : round2(num(l.material.custoUnit) * num(l.quantidade)))
      : inclusos.some((m) => m.custoUnit == null) ? null : round2(inclusos.reduce((s, m) => s + num(m.custoUnit) * num(m.quantidade), 0));
    return { id: l.id, tipo: l.tipo === "PRODUTO" ? "PRODUTO" : "SERVICO", servicoId: l.servicoId, categoria: l.servico?.categoria ?? null, descricao: l.descricao, quantidade: l.quantidade, valorTotal: l.valorTotal, custo };
  });
  const vinculados = new Set([a.ordemServico.equipamentoId, ...a.ordemServico.atividades.flatMap((x) => x.equipamentos.map((e) => e.equipamentoId))].filter(Boolean) as string[]);
  const porEquipamento: Record<string, number> = {};
  for (const e of a.equipamentos) {
    // "Para quem executou": quem já marcou; ainda não marcado, quem está com o aparelho (é ele quem vai marcar)
    const unidades = unidadesDaOs(linhas, vinculados.size, [{ atividadeId: a.id, equipamentoId: e.equipamentoId, feitoPorTecnicoId: e.feito ? e.feitoPorId : eu.tecnicoId }]);
    const valor = round2(unidades.flatMap((u) => comissoesDaUnidade(u, participantes, regras, cfg?.comissaoLiquidaImpostos ?? false)).filter((k) => k.participante.usuarioId === usuarioId).reduce((s, k) => s + k.valor, 0));
    if (valor > 0) porEquipamento[e.equipamentoId] = valor;
  }
  const ja = await prisma.comissao.findMany({ where: { empresaId, usuarioId, atividadeId, equipamentoId: { not: null } }, select: { equipamentoId: true, valor: true } });
  const confirmadas: Record<string, number> = {};
  for (const c of ja) confirmadas[c.equipamentoId!] = round2((confirmadas[c.equipamentoId!] ?? 0) + num(c.valor));
  return { porEquipamento, confirmadas };
}
