import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orcamentoJaFaturado, travarParaFaturar } from "@/lib/faturamento-os";
import { aFaturar, chaveMesBR } from "@/lib/financeiro/a-faturar";
import { formatarData, formatarMoeda, gerarNumeroContaReceber, gerarNumeroContaPagar, gerarNumeroMedicao } from "@/lib/utils";
import { diaCivilPassou, hojeDiaCivil, inicioMesDiaCivil, partesBR } from "@/lib/fuso";
import { calcularVencimento } from "@/lib/medicao-helpers";
import { rotuloMedicao } from "@/lib/faturamento/fatura";
import { cancelarParcelas, reajustarParcelas, recebidoNoPeriodo, saldoDoAgregado } from "@/lib/financeiro/parcelas-server";
import {
  type CobrancaContrato, competenciasDoContrato, detalheCancelamento, detalheReaberta, eventoDoContrato, mudancasDaCobranca,
  descricaoDaCobranca, passoCobranca, planoSincronizacao, valorMensalDe, vencimentoDaCompetencia,
} from "@/lib/financeiro/contrato-previsao";

type Db = Prisma.TransactionClient | typeof prisma;

/** P2002 = a trava única do banco (C6/C7) pegou uma corrida: a conta já existe */
const ehDuplicada = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Cria (de forma idempotente) uma conta a receber a partir de uma medição.
 * Se já existir conta vinculada à medição, retorna a existente.
 * Trava (b): roda numa transação com a medição TRANCADA — dois "Aprovar" ao mesmo tempo esperam na
 * fila e o segundo encontra a conta do primeiro; o índice único do banco é a última barreira.
 * Trava (c): a previsão (PREVISTO) do orçamento que a medição fatura VIRA a cobrança da medição
 * (em vez de nascer outra conta para o mesmo serviço).
 */
export async function gerarContaReceberDaMedicao(medicaoId: string) {
  try {
    return await prisma.$transaction((tx) => contaDaMedicao(tx, medicaoId), { timeout: 20_000 });
  } catch (e) {
    if (!ehDuplicada(e)) throw e;
    return prisma.contaReceber.findFirst({ where: { medicaoId, status: { not: "CANCELADO" } }, orderBy: { criadoEm: "asc" } });
  }
}

/** Valor que a conta da medição cobra: valor da nota (líquido de desconto) − retenções marcadas */
export function valorACobrarDaMedicao(m: { valorLiquido: unknown; valorRetencoes?: unknown }) {
  return Math.round((Number(m.valorLiquido) - Number(m.valorRetencoes ?? 0)) * 100) / 100;
}

/** Orçamentos que a medição fatura: direto (item) ou pela OS gerada deles (itens copiados) */
async function orcamentosDaMedicao(tx: Db, m: { itens: { orcamentoId: string | null; ordemServicoId: string | null }[]; relatorios: { ordemServicoId: string }[] }) {
  const osIds = [...new Set([...m.itens.map((i) => i.ordemServicoId), ...m.relatorios.map((r) => r.ordemServicoId)].filter(Boolean))] as string[];
  const origens = osIds.length
    ? (await tx.ordemServico.findMany({ where: { id: { in: osIds }, orcamentoOrigemId: { not: null } }, select: { orcamentoOrigemId: true } })).map((o) => o.orcamentoOrigemId)
    : [];
  return [...new Set([...m.itens.map((i) => i.orcamentoId), ...origens].filter(Boolean))] as string[];
}

/** Previsões (PREVISTO, ainda sem medição) dos orçamentos que a medição fatura — candidatas a virar a cobrança */
async function previsoesDeOrcamento(tx: Db, m: { id: string; empresaId: string; clienteId: string }, orcamentoIds: string[]) {
  if (!orcamentoIds.length) return [];
  return tx.contaReceber.findMany({
    where: {
      empresaId: m.empresaId, clienteId: m.clienteId, orcamentoId: { in: orcamentoIds }, medicaoId: null, contratoId: null,
      excluidaEm: null, status: "PREVISTO", OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }],
    },
    orderBy: { criadoEm: "asc" },
  });
}

/** Motivo gravado nas previsões absorvidas (é por ele que o cancelamento da medição as revive) */
export const motivoFaturadaNaMedicao = (numero: string) => `Faturada na medição ${numero}`;

/** As previsões de orçamento cobertas pela conta da medição deixam de valer (o valor está na conta da medição) */
async function absorverPrevisoes(tx: Db, m: { empresaId: string; numero: string }, cobranca: { id: string; numero: string }, previsoes: { id: string }[]) {
  for (const p of previsoes) {
    if (p.id === cobranca.id) continue;
    await tx.contaReceber.update({
      where: { id: p.id },
      data: { status: "CANCELADO", canceladaEm: new Date(), motivoCancelamento: motivoFaturadaNaMedicao(m.numero) },
    });
    await tx.contaReceberEvento.create({
      data: { empresaId: m.empresaId, contaReceberId: p.id, tipo: "CANCELADA", detalhe: `Cobrada na conta ${cobranca.numero} (medição ${m.numero}).` },
    });
  }
}

async function contaDaMedicao(tx: Prisma.TransactionClient, medicaoId: string) {
  await tx.$queryRaw`SELECT id FROM medicoes WHERE id = ${medicaoId} FOR UPDATE`;
  const medicao = await tx.medicao.findUnique({
    where: { id: medicaoId },
    include: {
      cliente: { select: { cpfCnpj: true } },
      itens: { select: { orcamentoId: true, ordemServicoId: true } },
      relatorios: { select: { ordemServicoId: true } },
    },
  });
  if (!medicao) return null;

  // Status da conta acompanha o estágio da medição: se a NF já foi emitida,
  // a conta já está liberada para recebimento (corrige o perfil AUTOMATICO,
  // que cria a medição direto em NF_EMITIDA).
  const status =
    medicao.status === "PAGO" ? "RECEBIDO" :
    medicao.status === "NF_EMITIDA" || medicao.status === "BOLETO_GERADO" ? "A_RECEBER" :
    "PREVISTO";
  const valor = valorACobrarDaMedicao(medicao);
  const previsoes = await previsoesDeOrcamento(tx, medicao, await orcamentosDaMedicao(tx, medicao));

  // C6/D3: a previsão do contrato JÁ É a conta da medição mensal — promove em vez de criar
  // outra (fim da cobrança em dobro PREVISTO × medição). Quando for uma só, o valor passa a
  // ser o da medição (cobre desconto e adicionais consolidados).
  const vinculadas = await tx.contaReceber.findMany({
    // Em perda também não acompanha mais a medição (quem desfaz é o "Reverter perda")
    where: { medicaoId, status: { notIn: ["RECEBIDO", "CANCELADO", "PARCELADO", "PERDA", "RENEGOCIADO"] } },
    orderBy: { criadoEm: "asc" },
  });
  // Conta da medição já PARCELADA: a cobrança está nas parcelas — elas acompanham o estágio da medição
  // (previstas → a receber) e o total (reajuste na proporção, se ainda nenhuma se mexeu)
  const parcelada = await tx.contaReceber.findFirst({ where: { medicaoId, status: "PARCELADO", excluidaEm: null } });
  if (parcelada && !vinculadas.length) {
    if (status === "A_RECEBER") await tx.contaReceber.updateMany({ where: { lancamentoId: parcelada.id, status: "PREVISTO" }, data: { status: "A_RECEBER" } });
    if (Number(parcelada.valor) !== valor) await reajustarParcelas(tx, { empresaId: medicao.empresaId, lancamentoId: parcelada.id, novoTotal: valor, motivo: `Valor da ${rotuloMedicao(medicao).replace(/^\S/, (c) => c.toLowerCase())}` });
    return parcelada;
  }
  if (vinculadas.length > 0) {
    for (const c of vinculadas) {
      await tx.contaReceber.update({
        where: { id: c.id },
        data: {
          status,
          dataVencimento: medicao.dataVencimento ?? c.dataVencimento,
          ...(vinculadas.length === 1 ? { valor } : {}),
        },
      });
    }
    // Uma conta só leva o valor da medição inteira (inclui os orçamentos da fatura única)
    if (vinculadas.length === 1) await absorverPrevisoes(tx, medicao, vinculadas[0], previsoes);
    return tx.contaReceber.findFirst({ where: { medicaoId }, orderBy: { criadoEm: "asc" } });
  }
  const jaRecebida = await tx.contaReceber.findFirst({ where: { medicaoId } });
  if (jaRecebida) return jaRecebida;

  // Medição mensal de contrato sem conta ligada ainda: ADOTA a previsão da competência
  // (contrato + mês/ano) em vez de criar uma segunda conta para o mesmo mês.
  if (medicao.contratoId && medicao.mes && medicao.ano) {
    const previsao = await tx.contaReceber.findFirst({
      where: { contratoId: medicao.contratoId, refAno: medicao.ano, refMes: medicao.mes, status: "PREVISTO", medicaoId: null },
    });
    if (previsao) {
      const conta = await tx.contaReceber.update({
        where: { id: previsao.id },
        data: { medicaoId: medicao.id, status, valor, dataVencimento: medicao.dataVencimento ?? previsao.dataVencimento },
      });
      await absorverPrevisoes(tx, medicao, conta, previsoes);
      return conta;
    }
  }

  // C6 (c): o orçamento aprovado já tinha uma previsão — ela VIRA a cobrança desta medição
  if (previsoes.length) {
    const [adotada] = previsoes;
    const conta = await tx.contaReceber.update({
      where: { id: adotada.id },
      data: { medicaoId: medicao.id, status, valor, dataVencimento: medicao.dataVencimento ?? adotada.dataVencimento },
    });
    await tx.contaReceberEvento.create({
      data: {
        empresaId: medicao.empresaId, contaReceberId: conta.id, tipo: "FATURADA",
        detalhe: `Previsão do orçamento virou a cobrança da ${rotuloMedicao(medicao).replace(/^\S/, (c) => c.toLowerCase())} (${formatarMoeda(Number(adotada.valor))} → ${formatarMoeda(valor)}).`,
      },
    });
    await absorverPrevisoes(tx, medicao, conta, previsoes);
    return conta;
  }

  const ano = medicao.ano ?? partesBR().ano;
  const numero = await proximoNumeroContaReceber(medicao.empresaId, ano, tx);

  return tx.contaReceber.create({
    data: {
      empresaId: medicao.empresaId,
      clienteId: medicao.clienteId,
      medicaoId: medicao.id,
      contratoId: medicao.contratoId ?? null,
      refMes: medicao.contratoId ? medicao.mes : null,
      refAno: medicao.contratoId ? medicao.ano : null,
      numero,
      descricao: medicao.descricao || `Medição ${medicao.numero}`,
      valor,
      status,
      dataVencimento: medicao.dataVencimento,
      clienteCnpj: medicao.cliente?.cpfCnpj ?? null,
    },
  });
}

/** Próximo número sequencial de conta a receber (CR-AAAA-NNNN) baseado no maior do ano. */
export async function proximoNumeroContaReceber(empresaId: string, ano: number, db: Db = prisma) {
  const ultimo = await db.contaReceber.findFirst({
    where: { empresaId, numero: { startsWith: `CR-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  // parseInt: a parcela "CR-2026-0042/3" conta como a 0042 (o lançamento dela)
  const seq = ultimo ? (parseInt(ultimo.numero.split("-")[2], 10) || 0) + 1 : 1;
  return gerarNumeroContaReceber(seq, ano);
}

/**
 * Cria (de forma idempotente) uma conta a receber a partir de um orçamento aprovado.
 * Trava (c): orçamento trancado na transação; se ele (ou a OS gerada dele) JÁ entrou numa medição
 * viva, não nasce previsão nenhuma — a cobrança é a da medição.
 */
export async function gerarContaReceberDoOrcamento(orcamentoId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orcamentos WHERE id = ${orcamentoId} FOR UPDATE`;
      const existente = await tx.contaReceber.findFirst({ where: { orcamentoId } });
      if (existente) return existente;

      const orcamento = await tx.orcamento.findUnique({ where: { id: orcamentoId } });
      if (!orcamento) return null;
      // CO3: proposta de CONTRATO assinada não vira conta avulsa — quem fatura o contrato são as
      // previsões mensais criadas quando o contrato é gerado (senão o mesmo dinheiro entra 2×).
      if (orcamento.tipo === "PROPOSTA_CONTRATO") return null;
      if (await orcamentoJaFaturado(orcamentoId, tx)) return null;

      const numero = await proximoNumeroContaReceber(orcamento.empresaId, partesBR().ano, tx);

      return tx.contaReceber.create({
        data: {
          empresaId: orcamento.empresaId,
          clienteId: orcamento.clienteId,
          orcamentoId: orcamento.id,
          numero,
          descricao: `Orçamento ${orcamento.codigo} — ${orcamento.nome}`,
          valor: orcamento.totalGeral,
          status: "PREVISTO",
          dataVencimento: orcamento.validadeEm,
        },
      });
    }, { timeout: 20_000 });
  } catch (e) {
    if (!ehDuplicada(e)) throw e;
    return prisma.contaReceber.findFirst({ where: { orcamentoId, status: { not: "CANCELADO" } } });
  }
}

/**
 * Medição cancelada (F4): as contas voltam ao que eram antes dela, para o serviço poder ser refaturado.
 * - de CONTRATO: volta a ser a previsão da competência (desligada, valor da mensalidade) — C6;
 * - previsão de ORÇAMENTO que virou a cobrança: volta a ser a previsão do orçamento (total dele);
 * - previsões de orçamento que ela absorveu: revivem;
 * - conta criada só para esta medição: cancelada.
 */
export async function desfazerContasDaMedicao(m: { id: string; numero: string; empresaId: string }, usuarioId?: string | null) {
  const evento = (contaReceberId: string, tipo: string, detalhe: string) =>
    prisma.contaReceberEvento.create({ data: { empresaId: m.empresaId, contaReceberId, tipo, detalhe, usuarioId: usuarioId ?? null } });
  const vinculadas = await prisma.contaReceber.findMany({
    where: { medicaoId: m.id, status: { notIn: ["RECEBIDO", "CANCELADO"] } },
    include: { contrato: { select: { valorMensal: true } }, orcamento: { select: { totalGeral: true } } },
  });
  for (const c of vinculadas) {
    // Conta parcelada (quem chama já recusou se alguma parcela teve dinheiro/boleto): as parcelas são
    // canceladas e o lançamento segue a regra da origem, como uma conta comum
    if (c.status === "PARCELADO") await cancelarParcelas(prisma, { lancamentoId: c.id, empresaId: m.empresaId, motivo: `Medição ${m.numero} cancelada`, usuarioId });
    if (c.contratoId) {
      await prisma.contaReceber.update({
        where: { id: c.id },
        data: { medicaoId: null, status: "PREVISTO", valor: c.contrato?.valorMensal ?? c.valor },
      });
    } else if (c.orcamentoId) {
      await prisma.contaReceber.update({
        where: { id: c.id },
        data: { medicaoId: null, status: "PREVISTO", valor: c.orcamento?.totalGeral ?? c.valor },
      });
      await evento(c.id, "REABERTA", `Medição ${m.numero} cancelada: volta a ser a previsão do orçamento.`);
    } else {
      await prisma.contaReceber.update({
        where: { id: c.id },
        data: { status: "CANCELADO", canceladaEm: new Date(), motivoCancelamento: `Medição ${m.numero} cancelada` },
      });
      await evento(c.id, "CANCELADA", `Medição ${m.numero} cancelada.`);
    }
  }
  const absorvidas = await prisma.contaReceber.findMany({
    where: { empresaId: m.empresaId, status: "CANCELADO", excluidaEm: null, motivoCancelamento: motivoFaturadaNaMedicao(m.numero) },
    select: { id: true },
  });
  for (const a of absorvidas) {
    try {
      await prisma.contaReceber.update({ where: { id: a.id }, data: { status: "PREVISTO", canceladaEm: null, motivoCancelamento: null } });
      await evento(a.id, "REABERTA", `Medição ${m.numero} cancelada: volta a ser a previsão do orçamento.`);
    } catch (e) {
      if (!ehDuplicada(e)) throw e; // o orçamento já tem outra conta viva: esta fica cancelada
    }
  }
}

/**
 * Cria (de forma idempotente) uma medição financeira a partir de um relatório
 * aprovado. O status segue o perfil de faturamento do cliente:
 * - COM_APROVACAO (perfil 1) → AGUARDANDO_PC
 * - AUTOMATICO (perfil 2)    → NF_EMITIDA (preparado para integração de NF)
 * - FATURA_UNICA (perfil 3)  → RASCUNHO (aguarda agrupamento do mês)
 * - sem perfil               → PC_RECEBIDO (libera NF)
 */
export async function criarMedicaoDeRelatorio(relatorioId: string) {
  const relatorio = await prisma.relatorioOs.findUnique({
    where: { id: relatorioId },
    include: { ordemServico: { include: { cliente: true } }, medicao: { select: { id: true, status: true } } },
  });
  if (!relatorio) return null;
  // F3: relatório COMUM de atividade aprovado NÃO fatura nada (a medição de R$ 0 que ele
  // criava, de tipo mensal, calava o gerar-mes e a mensalidade do mês sumia em silêncio).
  if (relatorio.escopo !== "MEDICAO_COMPLETA") return null;
  const valorFinanceiro = relatorio.valorFinanceiro ? Number(relatorio.valorFinanceiro) : 0;
  if (valorFinanceiro <= 0) return null;
  const cliente = relatorio.ordemServico.cliente;
  const perfil = cliente.tipoFaturamento;
  // Trava (a): relatório e OS trancados na transação. Medição VIVA já vinculada → devolve;
  // CANCELADA → cria outra no lugar (F4). A OS já numa OUTRA medição viva (botão "Gerar medição",
  // medição manual, fatura única) → não nasce a segunda cobrança.
  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM relatorios_os WHERE id = ${relatorioId} FOR UPDATE`;
    const atual = await tx.relatorioOs.findUnique({ where: { id: relatorioId }, select: { medicao: { select: { id: true, status: true } } } });
    if (atual?.medicao && atual.medicao.status !== "CANCELADA") {
      return { medicao: await tx.medicao.findUnique({ where: { id: atual.medicao.id } }), nova: false };
    }
    const travadas = await travarParaFaturar(tx, { osIds: [relatorio.ordemServicoId] });
    if (travadas.os.length) {
      console.warn("[faturamento] OS já faturada; relatório não gera outra medição", relatorio.ordemServicoId, travadas.os[0].medicao.numero);
      return { medicao: null, nova: false };
    }

    const status =
      perfil === "COM_APROVACAO" ? "AGUARDANDO_PC" :
      perfil === "AUTOMATICO" ? "NF_EMITIDA" :
      perfil === "FATURA_UNICA" ? "RASCUNHO" :
      "PC_RECEBIDO";

    const valor = relatorio.valorFinanceiro ? Number(relatorio.valorFinanceiro) : 0;
    const ultimaMed = await tx.medicao.findFirst({
      where: { empresaId: relatorio.empresaId, numero: { startsWith: `MED-${relatorio.anoReferencia}-` } },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });
    const seq = ultimaMed ? Number(ultimaMed.numero.split("-")[2]) + 1 : 1;
    const numero = gerarNumeroMedicao(seq, relatorio.anoReferencia);
    const vencimento = calcularVencimento(cliente.diaFaturamento, relatorio.mesReferencia, relatorio.anoReferencia);

    const medicao = await tx.medicao.create({
      data: {
        empresaId: relatorio.empresaId,
        clienteId: relatorio.ordemServico.clienteId,
        contratoId: relatorio.contratoId,
        numero,
        // Medição de contrato é a mensalidade (MENSAL_FIXO); sem contrato é serviço avulso
        // (ADICIONAL) e NÃO pode calar o gerar-mes da mensalidade do cliente (F3/I25)
        tipo: relatorio.contratoId ? "MENSAL_FIXO" : "ADICIONAL",
        mes: relatorio.mesReferencia,
        ano: relatorio.anoReferencia,
        descricao: `Relatório ${relatorio.numero}`,
        status: status as any,
        valorTotal: valor,
        valorLiquido: valor,
        dataAprovacao: new Date(),
        dataVencimento: vencimento,
        tokenPublico: crypto.randomUUID(),
        itens: {
          create: [{
            tipo: "SERVICO",
            descricao: `Serviço do período — ${relatorio.numero}`,
            quantidade: 1,
            valorUnitario: valor,
            valorTotal: valor,
            ordem: 0,
          }],
        },
      },
    });

    await tx.relatorioOs.update({ where: { id: relatorioId }, data: { medicaoId: medicao.id } });
    return { medicao, nova: true };
  }, { timeout: 20_000 });
  if (!r.medicao || !r.nova) return r.medicao;
  const medicao = r.medicao;

  // Gera conta a receber, exceto quando aguarda agrupamento (perfil fatura única)
  if (perfil !== "FATURA_UNICA") {
    await gerarContaReceberDaMedicao(medicao.id);
  }

  return medicao;
}

// ─────────────────────────────────────────────
// CONTRATOS → PREVISÃO DE CONTAS A RECEBER
// ─────────────────────────────────────────────

/**
 * CO2: só contrato ATIVO movimenta o financeiro e a recorrência. Cancelado, vencido,
 * em renovação, aguardando assinatura, suspenso ou encerrado NÃO geram previsão nem OS.
 */
export function contratoGeraFinanceiro(status: string | null | undefined): boolean {
  return status === "ATIVO";
}

export { competenciasDoContrato } from "@/lib/financeiro/contrato-previsao";

/**
 * Gera (de forma idempotente) a previsão de contas a receber de um contrato.
 * D3: a cobrança do contrato é SEMPRE mensal (valor fixo por mês), independente da
 * frequência das visitas (CO1). C6: cada previsão nasce LIGADA ao contrato e à
 * competência (uma por contrato × mês — unique no banco). Só contrato ATIVO gera (CO2).
 * Cria apenas competências de hoje em diante. Retorna a quantidade criada (ou revivida).
 */
export async function gerarPrevisaoContratoContasReceber(contratoId: string, usuarioId?: string | null): Promise<number> {
  const contrato = await prisma.contrato.findUnique({
    where: { id: contratoId },
    include: { cliente: { select: { cpfCnpj: true, diaFaturamento: true } } },
  });
  if (!contrato) return 0;
  const valor = valorMensalDe(contrato);
  const passo = passoCobranca(contrato.periodicidade);
  if (valor <= 0) return 0;
  if (!contratoGeraFinanceiro(contrato.status)) return 0;

  const hojeBR = partesBR(); // competência corrente pelo mês de Brasília

  // Categoria "Contrato": ligada por ID quando a empresa tem uma categoria ATIVA com esse nome
  // (mesma regra da migração: nome exato); senão fica só o texto, como sempre foi.
  const catContrato = await prisma.categoriaFinanceira.findFirst({
    where: { empresaId: contrato.empresaId, nome: "Contrato", ativo: true }, orderBy: { criadoEm: "asc" }, select: { id: true },
  });

  let criadas = 0;
  for (const { ano, mes } of competenciasDoContrato(contrato.dataInicio, contrato.dataFim, undefined, passo)) {
    const mes0 = mes - 1;
    // Da competência CORRENTE em diante (o mês atual ainda vai ser faturado pelo gerar-mes;
    // meses já passados não nascem)
    if (ano < hojeBR.ano || (ano === hojeBR.ano && mes0 < hojeBR.mes)) continue;
    const venc = vencimentoDaCompetencia(contrato, ano, mes, contrato.cliente?.diaFaturamento);

    const tag = `${ano}${String(mes).padStart(2, "0")}`;
    const numero = `${contrato.numero}/${tag}`;

    // Idempotência: pela competência ligada (C6) e, para dados antigos, pelo numero
    const existente = await prisma.contaReceber.findFirst({
      where: {
        OR: [
          { contratoId: contrato.id, refAno: ano, refMes: mes },
          { empresaId: contrato.empresaId, clienteId: contrato.clienteId, numero },
        ],
      },
      select: { id: true, status: true, medicaoId: true, canceladaEm: true, excluidaEm: true, observacao: true },
    });
    if (existente) {
      // Contrato reativado / de novo na vigência (CO2): a previsão que o CONTRATO cancelou
      // REVIVE — não nasce uma segunda linha (a competência é única por contrato). A que a
      // pessoa cancelou à mão continua cancelada.
      if (existente.status === "CANCELADO" && !existente.medicaoId && !existente.excluidaEm && await canceladaPeloContrato(existente)) {
        const r = await prisma.contaReceber.updateMany({
          where: { id: existente.id, status: "CANCELADO", medicaoId: null },
          data: {
            status: "PREVISTO", valor, dataVencimento: venc, canceladaEm: null, motivoCancelamento: null, descricao: descricaoDaCobranca(contrato, ano, mes),
            // o encerramento antigo escrevia o motivo na observação
            ...(existente.observacao && !existente.canceladaEm ? { observacao: null } : {}),
          },
        });
        if (r.count) {
          await prisma.contaReceberEvento.create({
            data: { empresaId: contrato.empresaId, contaReceberId: existente.id, tipo: "REABERTA", detalhe: detalheReaberta(contrato.numero), usuarioId: usuarioId ?? null },
          });
          criadas++;
        }
      }
      continue;
    }

    await prisma.contaReceber.create({
      data: {
        empresaId: contrato.empresaId,
        clienteId: contrato.clienteId,
        contratoId: contrato.id,
        refAno: ano,
        refMes: mes,
        numero,
        descricao: descricaoDaCobranca(contrato, ano, mes),
        valor,
        status: "PREVISTO",
        dataVencimento: venc,
        categoria: "Contrato",
        categoriaId: catContrato?.id ?? null,
        clienteCnpj: contrato.cliente?.cpfCnpj ?? null,
      },
    });
    criadas++;
  }

  return criadas;
}

/**
 * A previsão cancelada foi cancelada PELO CONTRATO? Sem data de cancelamento é a do
 * encerramento antigo (que só escrevia na observação) — revive como sempre reviveu. Com data,
 * só se o último cancelamento na linha do tempo foi escrito pelo contrato.
 */
async function canceladaPeloContrato(c: { id: string; canceladaEm: Date | null }) {
  if (!c.canceladaEm) return true;
  const ultimo = await prisma.contaReceberEvento.findFirst({
    where: { contaReceberId: c.id, tipo: "CANCELADA" }, orderBy: { criadoEm: "desc" }, select: { detalhe: true },
  });
  return eventoDoContrato(ultimo?.detalhe);
}

/** As previsões do contrato que ainda são só previsão: nada faturado, nenhum boleto vivo, não excluída */
const previsoesAbertasDoContrato = (contratoId: string): Prisma.ContaReceberWhereInput => ({
  contratoId, status: "PREVISTO", medicaoId: null, lancamentoId: null, excluidaEm: null,
  OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }],
});

/**
 * Cancela UMA previsão em nome do contrato: status + data + motivo + evento na linha do tempo.
 * A escrita confere de novo que ainda é previsão pura (se o gerar-mes ligou a conta a uma
 * medição, ou saiu um boleto, no meio do caminho, ela fica como está). Devolve se cancelou.
 */
async function cancelarPrevisaoDoContrato(c: { id: string; empresaId: string }, motivo: string, usuarioId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.contaReceber.updateMany({
      where: { id: c.id, status: "PREVISTO", medicaoId: null, OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }] },
      data: { status: "CANCELADO", canceladaEm: new Date(), motivoCancelamento: motivo },
    });
    if (!r.count) return false;
    await tx.contaReceberEvento.create({
      data: { empresaId: c.empresaId, contaReceberId: c.id, tipo: "CANCELADA", detalhe: detalheCancelamento(motivo), usuarioId: usuarioId ?? null },
    });
    return true;
  });
}

/**
 * Contrato EDITADO (continua ATIVO): as previsões ainda abertas acompanham o contrato.
 * - fora da nova vigência (ou contrato sem valor mensal) → canceladas, com motivo e evento;
 * - da competência corrente em diante → valor e/ou vencimento novos, só no que mudou
 *   (`antes` × contrato atual), com evento "Editada" dizendo de quanto para quanto.
 * Nada que já virou cobrança (medição, boleto, recebimento) muda. Depois disto, o
 * `gerarPrevisaoContratoContasReceber` cria os meses que entraram na vigência.
 */
export async function sincronizarPrevisoesDoContrato(contratoId: string, antes: CobrancaContrato, usuarioId?: string | null) {
  const contrato = await prisma.contrato.findUnique({ where: { id: contratoId }, include: { cliente: { select: { diaFaturamento: true } } } });
  if (!contrato || !contratoGeraFinanceiro(contrato.status)) return { atualizadas: 0, canceladas: 0 };
  const abertas = await prisma.contaReceber.findMany({
    where: previsoesAbertasDoContrato(contratoId),
    select: { id: true, refAno: true, refMes: true, valor: true, dataVencimento: true, descricao: true },
    orderBy: [{ refAno: "asc" }, { refMes: "asc" }],
  });
  const hojeBR = partesBR();
  const plano = planoSincronizacao(abertas, contrato, mudancasDaCobranca(antes, contrato), { ano: hojeBR.ano, mes: hojeBR.mes + 1 }, contrato.cliente?.diaFaturamento);

  let canceladas = 0;
  for (const c of plano.cancelar) {
    if (await cancelarPrevisaoDoContrato({ id: c.id, empresaId: contrato.empresaId }, c.motivo, usuarioId)) canceladas++;
  }
  let atualizadas = 0;
  for (const a of plano.atualizar) {
    const feito = await prisma.$transaction(async (tx) => {
      const r = await tx.contaReceber.updateMany({
        where: { id: a.id, status: "PREVISTO", medicaoId: null, OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }] },
        data: { ...(a.valor !== undefined ? { valor: a.valor } : {}), ...(a.dataVencimento ? { dataVencimento: a.dataVencimento } : {}) },
      });
      if (!r.count) return false;
      await tx.contaReceberEvento.create({
        data: { empresaId: contrato.empresaId, contaReceberId: a.id, tipo: "EDITADA", detalhe: a.detalhe, usuarioId: usuarioId ?? null },
      });
      return true;
    });
    if (feito) atualizadas++;
  }
  // D1/D5: mudou a periodicidade ou a referência da nota → o "Ref." das previsões que ficam acompanha
  const mudouPeriodo = passoCobranca(antes.periodicidade) !== passoCobranca(contrato.periodicidade)
    || (antes.nfseReferencia ?? "CORRENTE") !== contrato.nfseReferencia;
  const canceladasIds = new Set(plano.cancelar.map((c) => c.id));
  for (const p of mudouPeriodo ? abertas : []) {
    if (p.refAno == null || p.refMes == null || canceladasIds.has(p.id)) continue;
    const descricao = descricaoDaCobranca(contrato, p.refAno, p.refMes);
    if (p.descricao === descricao) continue;
    await prisma.contaReceber.updateMany({ where: { id: p.id, status: "PREVISTO", medicaoId: null }, data: { descricao } });
  }
  return { atualizadas, canceladas };
}

/**
 * CO2: quando o contrato deixa de estar ATIVO (cancelado, encerrado, suspenso, vencido, excluído…),
 * a receita fantasma é limpa: cancela as previsões (PREVISTO) ainda não faturadas do
 * contrato — com motivo e evento na linha do tempo — e as OS AGENDADAS futuras e intocadas
 * (sem execução e sem financeiro). Nada recebido/faturado é alterado. Retorna o que foi cancelado.
 */
export async function encerrarFinanceiroDoContrato(contratoId: string, motivo = "Contrato deixou de estar ativo", usuarioId?: string) {
  const agora = new Date();
  const abertas = await prisma.contaReceber.findMany({ where: previsoesAbertasDoContrato(contratoId), select: { id: true, empresaId: true } });
  let previsoesCanceladas = 0;
  for (const c of abertas) {
    if (await cancelarPrevisaoDoContrato(c, motivo, usuarioId)) previsoesCanceladas++;
  }

  // OS futuras e intocadas: AGENDADA, nenhuma atividade fora de AGENDADA, nenhuma atividade
  // passada, nada no financeiro (a trava osJaFaturada é por medição viva — aqui basta nenhum item)
  const candidatas = await prisma.ordemServico.findMany({
    where: {
      contratoId,
      status: "AGENDADA",
      medicaoItens: { none: {} },
      atividades: { none: { OR: [{ status: { not: "AGENDADA" } }, { dataAgendada: { lt: agora } }] } },
    },
    select: { id: true },
  });
  for (const os of candidatas) {
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CANCELADA" } });
    if (usuarioId) {
      await prisma.osHistorico.create({
        data: { ordemServicoId: os.id, usuarioId, acao: "OS cancelada", detalhes: motivo },
      });
    }
  }
  return { previsoesCanceladas, osCanceladas: candidatas.length };
}

// ─────────────────────────────────────────────
// CONTAS A PAGAR
// ─────────────────────────────────────────────

/** Próximo número sequencial de conta a pagar (CP-AAAA-NNNN). */
export async function proximoNumeroContaPagar(empresaId: string, ano: number) {
  const ultimo = await prisma.contaPagar.findFirst({
    where: { empresaId, numero: { startsWith: `CP-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = ultimo ? Number(ultimo.numero.split("-")[2]) + 1 : 1;
  return gerarNumeroContaPagar(seq, ano);
}

/** Recalcula valorPago, saldoRestante, status e dataPagamento a partir dos pagamentos. */
export async function recalcularContaPagar(contaPagarId: string) {
  const conta = await prisma.contaPagar.findUnique({
    where: { id: contaPagarId },
    include: { pagamentos: { orderBy: { dataPagamento: "desc" } } },
  });
  if (!conta) return null;
  if (conta.status === "CANCELADO") return conta;

  const valorTotal = Number(conta.valorTotal);
  const valorPago = conta.pagamentos.reduce((s, p) => s + Number(p.valor), 0);
  const saldoRestante = Math.max(0, valorTotal - valorPago);
  const venceu = diaCivilPassou(conta.dataVencimento); // só depois do dia de Brasília

  let status: "PENDENTE" | "PAGO_PARCIAL" | "PAGO_TOTAL" | "VENCIDO";
  if (saldoRestante <= 0.001) status = "PAGO_TOTAL";
  else if (valorPago > 0) status = "PAGO_PARCIAL";
  else status = venceu ? "VENCIDO" : "PENDENTE";

  return prisma.contaPagar.update({
    where: { id: contaPagarId },
    data: {
      valorPago,
      saldoRestante,
      status,
      dataPagamento: status === "PAGO_TOTAL" ? (conta.pagamentos[0]?.dataPagamento ?? new Date()) : null,
    },
  });
}

// ─────────────────────────────────────────────
// DASHBOARD FINANCEIRO
// ─────────────────────────────────────────────

/**
 * Marca como ATRASADO as contas a receber LIBERADAS (A_RECEBER) vencidas. PREVISTO não
 * vira ATRASADO (C6/F5): previsão de contrato ainda não faturada não é cobrança vencida —
 * era isso que marcava o cliente como inadimplente e enchia o portal de "boletos vencidos".
 * Único lugar da regra: dashboard e lista usam esta função.
 */
export async function marcarContasReceberVencidas(empresaId: string) {
  // Vencimento é dia civil: vence quando o dia de Brasília passou (não às 21h da véspera)
  return prisma.contaReceber.updateMany({
    where: { empresaId, status: "A_RECEBER", dataVencimento: { lt: hojeDiaCivil() } },
    data: { status: "ATRASADO" },
  });
}

/** Agregações para o dashboard financeiro: cards do mês, série de 6 meses e alertas. */
export async function resumoFinanceiro(empresaId: string) {
  // Tudo pelo calendário de Brasília; vencimento/recebimento/pagamento são dias civis
  const agora = new Date();
  const inicioMes = inicioMesDiaCivil(agora);
  const fimMes = new Date(inicioMesDiaCivil(agora, 1).getTime() - 1);
  const hojeIni = hojeDiaCivil(agora);
  const hojeFim = new Date(hojeDiaCivil(agora, 1).getTime() - 1);
  const tresDias = hojeDiaCivil(agora, -3);

  // Marca contas vencidas (receber e pagar)
  await marcarContasReceberVencidas(empresaId);
  await prisma.contaPagar.updateMany({
    where: { empresaId, status: "PENDENTE", dataVencimento: { lt: hojeIni } },
    data: { status: "VENCIDO" },
  });

  const naoRecebido: any[] = ["PREVISTO", "A_RECEBER", "ATRASADO"];
  const naoPago: any[] = ["PENDENTE", "PAGO_PARCIAL", "VENCIDO"];

  const [
    aReceberMes, recebidoMes, vencidoReceber, aPagarMesAgg, pagasVencidas,
    vencemHojeReceber, vencemHojePagar,
  ] = await Promise.all([
    // Em aberto pelo SALDO (a baixa parcial já entrou: valor − valorRecebido)
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: naoRecebido }, dataVencimento: { gte: inicioMes, lte: fimMes } }, _sum: { valor: true, valorRecebido: true }, _count: true }),
    // Recebido pela data de cada recebimento (parcial ou total) + as recebidas antigas
    recebidoNoPeriodo(empresaId, { gte: inicioMes, lte: fimMes }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: "ATRASADO" }, _sum: { valor: true, valorRecebido: true }, _count: true }),
    prisma.contaPagar.aggregate({ where: { empresaId, status: { in: naoPago }, dataVencimento: { gte: inicioMes, lte: fimMes } }, _sum: { saldoRestante: true }, _count: true }),
    prisma.contaPagar.aggregate({ where: { empresaId, status: "VENCIDO" }, _sum: { saldoRestante: true }, _count: true }),
    prisma.contaReceber.count({ where: { empresaId, status: { in: naoRecebido }, dataVencimento: { gte: hojeIni, lte: hojeFim } } }),
    prisma.contaPagar.count({ where: { empresaId, status: { in: naoPago }, dataVencimento: { gte: hojeIni, lte: hojeFim } } }),
  ]);

  // Vencidas há +3 dias sem notificação (receber)
  const semNotificacao = await prisma.contaReceber.count({
    where: { empresaId, status: "ATRASADO", dataVencimento: { lt: tresDias }, notificacaoEnviadaEm: null },
  });

  // Série de 6 meses (entradas recebidas x saídas pagas)
  const meses: { mes: string; entradas: number; saidas: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const ini = inicioMesDiaCivil(agora, -i);
    const fim = new Date(inicioMesDiaCivil(agora, -i + 1).getTime() - 1);
    const [ent, sai] = await Promise.all([
      recebidoNoPeriodo(empresaId, { gte: ini, lte: fim }),
      prisma.pagamentoContaPagar.aggregate({ where: { contaPagar: { empresaId }, dataPagamento: { gte: ini, lte: fim } }, _sum: { valor: true } }),
    ]);
    meses.push({
      mes: formatarData(ini, "MMM"),
      entradas: ent.valor,
      saidas: Number(sai._sum.valor ?? 0),
    });
  }

  const num = (v: any) => Number(v ?? 0);
  // Opção A (P3): os orçamentos aprovados "a faturar" do mês (sem conta desde a P2) entram na previsão
  // no lugar da conta Prevista que a aprovação criava — mesmo número no card e no saldo
  const mesAtual = chaveMesBR(agora);
  const faturar = await aFaturar(empresaId, { de: mesAtual, ate: mesAtual }, agora);
  const contasAReceberMes = saldoDoAgregado(aReceberMes);
  const totalAReceberMes = Math.round((contasAReceberMes + faturar.valor) * 100) / 100;
  const totalAPagarMes = num(aPagarMesAgg._sum?.saldoRestante);

  return {
    aReceberMes: {
      valor: totalAReceberMes, qtd: aReceberMes._count,
      /** Só as contas em aberto do mês (sem o "a faturar") */
      contas: contasAReceberMes,
      aFaturar: { valor: faturar.valor, qtd: faturar.qtd },
    },
    recebidoMes: { valor: recebidoMes.valor, qtd: recebidoMes.qtd },
    vencidoReceber: { valor: saldoDoAgregado(vencidoReceber), qtd: vencidoReceber._count },
    aPagarMes: { valor: totalAPagarMes, qtd: aPagarMesAgg._count },
    pagasVencidas: { valor: num(pagasVencidas._sum?.saldoRestante), qtd: pagasVencidas._count },
    saldoPrevisto: totalAReceberMes - totalAPagarMes,
    meses,
    alertas: {
      vencemHoje: vencemHojeReceber + vencemHojePagar,
      vencemHojeReceber, vencemHojePagar,
      vencidasSemNotificacao: semNotificacao,
    },
  };
}
