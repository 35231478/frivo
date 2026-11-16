/**
 * DESPESA RECORRENTE (contas a pagar) — o servidor: criar a regra, gerar as ocorrências, rolar o
 * horizonte, pausar/retomar/encerrar, pular uma ocorrência e editar com escopo.
 *
 * O desenho é o mesmo do contrato recorrente (lib/financeiro-server.ts):
 *  - uma conta por competência da regra, com a competência gravada na conta (refAno/refMes) e um
 *    ÍNDICE ÚNICO (recorrencia, ano, mês) no banco: é ele, e não o código, que impede gerar duas vezes;
 *  - regra sem término ganha horizonte rolante (~12 meses) que um cron empurra para a frente;
 *  - cada conta gerada é INDEPENDENTE: pagar, ajustar ou cancelar uma não mexe na regra nem nas outras;
 *  - dinheiro é razão: nada é apagado. Pular uma ocorrência é CANCELAR a conta; encerrar a regra é
 *    status na regra + cancelamento das contas FUTURAS que ainda estão em aberto (as pagas e as
 *    passadas ficam como estão).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { partesBR } from "@/lib/fuso";
import { proximoNumeroContaPagar } from "@/lib/financeiro-server";
import {
  MSG_CONTA_PAGA, MSG_ENCERRADA, MSG_JA_RECORRENTE,
  competenciaAntes, competenciasDaRegra, descricaoDaOcorrencia, horizonteRolante, ocorrenciaEditavel,
  ocorrenciasDoEscopo, regraDoEscopo, vencimentoDaOcorrencia,
  type Competencia, type EscopoEdicao, type RegraRecorrencia,
} from "./conta-pagar-recorrencia";

/** Meses à frente que uma regra sem término mantém gerados */
export const HORIZONTE_MESES = 12;

export class ErroRecorrencia extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Db = typeof prisma | Prisma.TransactionClient;

export const competenciaCorrente = (): Competencia => {
  const { ano, mes } = partesBR();
  return { ano, mes: mes + 1 }; // partesBR devolve o mês com base zero
};

/** O que a conta gerada herda da regra */
const dadosHerdados = (r: {
  descricao: string; favorecidoNome: string; fornecedorId: string | null; tecnicoId: string | null;
  categoriaId: string | null; centroCustoId: string | null; formaPagamento: string | null; observacao: string | null;
}) => ({
  fornecedorId: r.fornecedorId,
  fornecedor: r.favorecidoNome,
  tecnicoId: r.tecnicoId,
  categoriaId: r.categoriaId,
  centroCustoId: r.centroCustoId,
  formaPagamento: (r.formaPagamento ?? null) as never,
  observacao: r.observacao,
});

/**
 * Gera as contas que faltam para a regra, até o término (ou até o horizonte, quando indefinida).
 * Idempotente: o que já existe na competência não nasce de novo — nem quando duas chamadas correm
 * ao mesmo tempo (o índice único recusa e a competência é pulada).
 */
export async function gerarContasDaRecorrencia(
  recorrenciaId: string,
  o: { hoje?: Competencia; empresaId?: string } = {},
): Promise<number> {
  const hoje = o.hoje ?? competenciaCorrente();
  const regra = await prisma.contaPagarRecorrencia.findFirst({
    where: { id: recorrenciaId, ...(o.empresaId ? { empresaId: o.empresaId } : {}) },
  });
  if (!regra || regra.situacao !== "ATIVA") return 0;

  const limite = regra.fimAno && regra.fimMes ? { ano: regra.fimAno, mes: regra.fimMes } : horizonteRolante(hoje, HORIZONTE_MESES);
  const todas = competenciasDaRegra(regra as unknown as RegraRecorrencia, limite);
  // Competência passada não nasce: a despesa recorrente começa a valer de onde está
  const alvos = todas.filter((c) => !competenciaAntes(c, hoje));
  if (alvos.length === 0) return 0;

  const existentes = await prisma.contaPagar.findMany({
    where: { recorrenciaId, refAno: { in: alvos.map((c) => c.ano) } },
    select: { refAno: true, refMes: true },
  });
  const jaTem = new Set(existentes.map((c) => `${c.refAno}-${c.refMes}`));

  let criadas = 0;
  for (const c of alvos) {
    if (jaTem.has(`${c.ano}-${c.mes}`)) continue;
    const numero = await proximoNumeroContaPagar(regra.empresaId);
    const valor = Number(regra.valor);
    try {
      await prisma.contaPagar.create({
        data: {
          empresaId: regra.empresaId,
          numero,
          recorrenciaId: regra.id,
          refAno: c.ano,
          refMes: c.mes,
          descricao: descricaoDaOcorrencia(regra.descricao, c.ano, c.mes),
          valorTotal: valor,
          valorPago: 0,
          saldoRestante: valor,
          valorEstimado: regra.valorEstimado,
          status: "PENDENTE",
          dataVencimento: vencimentoDaOcorrencia(regra as unknown as RegraRecorrencia, c.ano, c.mes),
          ...dadosHerdados(regra),
        },
      });
      criadas++;
    } catch (e) {
      // P2002 = outra rodada criou a mesma competência no meio do caminho: é o dedup funcionando
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
  return criadas;
}

/** Horizonte rolante: todas as regras ativas sem término ganham os meses que faltam. */
export async function rolarHorizonteDeRecorrentes(o: { empresaId?: string } = {}) {
  const regras = await prisma.contaPagarRecorrencia.findMany({
    where: { ...(o.empresaId ? { empresaId: o.empresaId } : {}), situacao: "ATIVA" },
    select: { id: true },
    orderBy: { criadoEm: "asc" },
  });
  let contas = 0;
  let falhas = 0;
  for (const r of regras) {
    try { contas += await gerarContasDaRecorrencia(r.id); }
    catch (e) { falhas++; console.error("[recorrentes] regra", r.id, (e as Error)?.message); }
  }
  return { regras: regras.length, contas, falhas };
}

/* ───────── as ocorrências ───────── */

/** As contas da regra a partir de uma competência (inclusive), da mais antiga para a mais nova */
export function contasDaRecorrencia(recorrenciaId: string, db: Db = prisma) {
  return db.contaPagar.findMany({
    where: { recorrenciaId },
    orderBy: [{ refAno: "asc" }, { refMes: "asc" }],
    select: { id: true, refAno: true, refMes: true, status: true, valorPago: true, valorTotal: true, dataVencimento: true },
  });
}

/** As ocorrências FUTURAS ainda em aberto (as que uma pausa ou um encerramento cancela) */
const futurasEmAberto = (contas: Awaited<ReturnType<typeof contasDaRecorrencia>>, depois: Competencia) =>
  contas.filter((c) => c.refAno && c.refMes && competenciaAntes(depois, { ano: c.refAno, mes: c.refMes }) &&
    ocorrenciaEditavel({ id: c.id, refAno: c.refAno, refMes: c.refMes, status: c.status, valorPago: Number(c.valorPago) }));

/** Cancela (não apaga) um conjunto de contas, com o motivo na observação. */
async function cancelarContas(ids: string[], motivo: string) {
  if (ids.length === 0) return 0;
  const { count } = await prisma.contaPagar.updateMany({
    where: { id: { in: ids }, status: { in: ["PENDENTE", "VENCIDO"] }, valorPago: 0 },
    data: { status: "CANCELADO", observacao: motivo },
  });
  return count;
}

/** Pular UMA ocorrência: a conta é cancelada (status, nunca delete) e a regra continua valendo. */
export async function pularOcorrencia(empresaId: string, contaId: string) {
  const conta = await prisma.contaPagar.findFirst({ where: { id: contaId, empresaId } });
  if (!conta) throw new ErroRecorrencia("Conta não encontrada.", 404);
  if (!conta.recorrenciaId) throw new ErroRecorrencia("Esta conta não é de uma despesa recorrente.", 400);
  if (!ocorrenciaEditavel({ id: conta.id, refAno: conta.refAno, refMes: conta.refMes, status: conta.status, valorPago: Number(conta.valorPago) })) {
    throw new ErroRecorrencia(MSG_CONTA_PAGA, 409);
  }
  await cancelarContas([conta.id], "Ocorrência pulada: a despesa recorrente continua valendo.");
  return { ok: true };
}

/* ───────── a regra ───────── */

export interface DadosRecorrencia {
  descricao: string;
  favorecidoNome: string;
  fornecedorId?: string | null;
  tecnicoId?: string | null;
  categoriaId?: string | null;
  centroCustoId?: string | null;
  formaPagamento?: string | null;
  observacao?: string | null;
  passoMeses: number;
  diaVencimento: number;
  ajusteDiaNaoUtil?: string | null;
  valor: number;
  valorEstimado?: boolean;
  inicioAno: number;
  inicioMes: number;
  fimAno?: number | null;
  fimMes?: number | null;
  ocorrencias?: number | null;
}

/** Cria a regra e já gera as contas (até o término, ou até o horizonte). */
export async function criarRecorrencia(empresaId: string, d: DadosRecorrencia, usuarioId?: string | null) {
  const regra = await prisma.contaPagarRecorrencia.create({
    data: {
      empresaId,
      descricao: d.descricao.trim(),
      favorecidoNome: d.favorecidoNome.trim(),
      fornecedorId: d.fornecedorId ?? null,
      tecnicoId: d.tecnicoId ?? null,
      categoriaId: d.categoriaId ?? null,
      centroCustoId: d.centroCustoId ?? null,
      formaPagamento: (d.formaPagamento || null) as never,
      observacao: d.observacao || null,
      passoMeses: d.passoMeses,
      diaVencimento: d.diaVencimento,
      ajusteDiaNaoUtil: d.ajusteDiaNaoUtil || "MANTER",
      valor: d.valor,
      valorEstimado: !!d.valorEstimado,
      inicioAno: d.inicioAno,
      inicioMes: d.inicioMes,
      fimAno: d.fimAno ?? null,
      fimMes: d.fimMes ?? null,
      ocorrencias: d.ocorrencias ?? null,
      criadoPorId: usuarioId ?? null,
    },
  });
  const contas = await gerarContasDaRecorrencia(regra.id);
  return { regra, contas };
}

/** Pausar: para de gerar e tira da frente as contas futuras ainda em aberto. */
export async function pausarRecorrencia(empresaId: string, id: string) {
  const regra = await buscarRegra(empresaId, id);
  if (regra.situacao === "ENCERRADA") throw new ErroRecorrencia(MSG_ENCERRADA, 409);
  const canceladas = await cancelarContas(
    futurasEmAberto(await contasDaRecorrencia(id), competenciaCorrente()).map((c) => c.id),
    "Despesa recorrente pausada: esta ocorrência não será cobrada.",
  );
  await prisma.contaPagarRecorrencia.update({ where: { id }, data: { situacao: "PAUSADA", pausadaEm: new Date() } });
  return { canceladas };
}

/** Retomar: volta a valer e regera do mês corrente em diante. */
export async function retomarRecorrencia(empresaId: string, id: string) {
  const regra = await buscarRegra(empresaId, id);
  if (regra.situacao === "ENCERRADA") throw new ErroRecorrencia(MSG_ENCERRADA, 409);
  await prisma.contaPagarRecorrencia.update({ where: { id }, data: { situacao: "ATIVA", pausadaEm: null } });
  return { contas: await gerarContasDaRecorrencia(id) };
}

/**
 * Encerrar (é o que "excluir" faz): a regra para de vez e as contas FUTURAS em aberto são
 * canceladas — sem conta fantasma no fluxo de caixa. O histórico fica inteiro: nada é apagado, e as
 * contas pagas (ou do mês corrente) continuam como estão.
 */
export async function encerrarRecorrencia(empresaId: string, id: string, motivo?: string | null) {
  const regra = await buscarRegra(empresaId, id);
  if (regra.situacao === "ENCERRADA") return { canceladas: 0, jaEncerrada: true };
  const canceladas = await cancelarContas(
    futurasEmAberto(await contasDaRecorrencia(id), competenciaCorrente()).map((c) => c.id),
    "Despesa recorrente encerrada: esta ocorrência não será cobrada.",
  );
  await prisma.contaPagarRecorrencia.update({
    where: { id },
    data: { situacao: "ENCERRADA", encerradaEm: new Date(), encerramentoMotivo: motivo?.trim() || null },
  });
  return { canceladas, jaEncerrada: false };
}

async function buscarRegra(empresaId: string, id: string) {
  const regra = await prisma.contaPagarRecorrencia.findFirst({ where: { id, empresaId } });
  if (!regra) throw new ErroRecorrencia("Despesa recorrente não encontrada.", 404);
  return regra;
}

/** Edita a REGRA (sem escopo: vale para as ocorrências futuras em aberto, que são regeradas). */
export async function atualizarRecorrencia(empresaId: string, id: string, d: Partial<DadosRecorrencia>) {
  const regra = await buscarRegra(empresaId, id);
  if (regra.situacao === "ENCERRADA") throw new ErroRecorrencia(MSG_ENCERRADA, 409);

  await prisma.contaPagarRecorrencia.update({
    where: { id },
    data: {
      ...(d.descricao !== undefined && { descricao: d.descricao.trim() }),
      ...(d.favorecidoNome !== undefined && { favorecidoNome: d.favorecidoNome.trim() }),
      ...(d.fornecedorId !== undefined && { fornecedorId: d.fornecedorId }),
      ...(d.tecnicoId !== undefined && { tecnicoId: d.tecnicoId }),
      ...(d.categoriaId !== undefined && { categoriaId: d.categoriaId }),
      ...(d.centroCustoId !== undefined && { centroCustoId: d.centroCustoId }),
      ...(d.formaPagamento !== undefined && { formaPagamento: (d.formaPagamento || null) as never }),
      ...(d.observacao !== undefined && { observacao: d.observacao || null }),
      ...(d.passoMeses !== undefined && { passoMeses: d.passoMeses }),
      ...(d.diaVencimento !== undefined && { diaVencimento: d.diaVencimento }),
      ...(d.ajusteDiaNaoUtil !== undefined && { ajusteDiaNaoUtil: d.ajusteDiaNaoUtil || "MANTER" }),
      ...(d.valor !== undefined && { valor: d.valor }),
      ...(d.valorEstimado !== undefined && { valorEstimado: d.valorEstimado }),
      ...(d.fimAno !== undefined && { fimAno: d.fimAno }),
      ...(d.fimMes !== undefined && { fimMes: d.fimMes }),
      ...(d.ocorrencias !== undefined && { ocorrencias: d.ocorrencias }),
    },
  });

  // As futuras em aberto acompanham a regra nova; as pagas e as passadas ficam como estão
  const atualizada = await buscarRegra(empresaId, id);
  const contas = await contasDaRecorrencia(id);
  const alvo = competenciaCorrente();
  const futuras = futurasEmAberto(contas, alvo);
  for (const c of futuras) {
    await aplicarRegraNaConta(atualizada, c.id, c.refAno!, c.refMes!);
  }
  // término pode ter andado para a frente: gera o que passou a caber
  const geradas = await gerarContasDaRecorrencia(id);
  // término pode ter encolhido: o que ficou fora da regra sai do caminho
  const fora = await ocorrenciasForaDaRegra(atualizada, alvo);
  const canceladas = await cancelarContas(fora, "Fora do período da despesa recorrente: ocorrência cancelada.");
  return { atualizadas: futuras.length, geradas, canceladas };
}

/** As contas em aberto cuja competência a regra não gera mais (término encurtado, passo mudado) */
async function ocorrenciasForaDaRegra(regra: { id: string; fimAno: number | null; fimMes: number | null }, hoje: Competencia) {
  const limite = regra.fimAno && regra.fimMes ? { ano: regra.fimAno, mes: regra.fimMes } : horizonteRolante(hoje, HORIZONTE_MESES);
  const validas = new Set(competenciasDaRegra(regra as unknown as RegraRecorrencia, limite).map((c) => `${c.ano}-${c.mes}`));
  const contas = await contasDaRecorrencia(regra.id);
  return futurasEmAberto(contas, hoje).filter((c) => !validas.has(`${c.refAno}-${c.refMes}`)).map((c) => c.id);
}

/** Copia para a conta o que a regra manda (valor, vencimento, descrição e os herdados). */
async function aplicarRegraNaConta(regra: Awaited<ReturnType<typeof buscarRegra>>, contaId: string, ano: number, mes: number) {
  const valor = Number(regra.valor);
  await prisma.contaPagar.update({
    where: { id: contaId },
    data: {
      descricao: descricaoDaOcorrencia(regra.descricao, ano, mes),
      valorTotal: valor,
      saldoRestante: valor,
      valorEstimado: regra.valorEstimado,
      dataVencimento: vencimentoDaOcorrencia(regra as unknown as RegraRecorrencia, ano, mes),
      ...dadosHerdados(regra),
    },
  });
}

/* ───────── editar uma OCORRÊNCIA com escopo ───────── */

export interface MudancaDaOcorrencia {
  valorTotal?: number;
  dataVencimento?: Date | null;
}

/**
 * Edita a conta gerada com o alcance escolhido:
 *  - "ESTA": só aquela conta (ajuste pontual do mês);
 *  - "ESTA_E_PROXIMAS": muda a REGRA daqui para a frente (valor e dia do vencimento) e repassa às
 *    contas futuras que ainda estão em aberto.
 * Em nenhum dos dois uma conta paga, parcialmente paga ou cancelada é tocada.
 */
export async function editarOcorrenciaComEscopo(
  empresaId: string, contaId: string, escopo: EscopoEdicao, mudanca: MudancaDaOcorrencia,
) {
  const conta = await prisma.contaPagar.findFirst({ where: { id: contaId, empresaId } });
  if (!conta) throw new ErroRecorrencia("Conta não encontrada.", 404);
  if (!conta.recorrenciaId) throw new ErroRecorrencia("Esta conta não é de uma despesa recorrente.", 400);
  const alvo = { id: conta.id, refAno: conta.refAno, refMes: conta.refMes, status: conta.status, valorPago: Number(conta.valorPago) };
  if (!ocorrenciaEditavel(alvo)) throw new ErroRecorrencia(MSG_CONTA_PAGA, 409);

  const contas = await contasDaRecorrencia(conta.recorrenciaId);
  const lista = contas.map((c) => ({ id: c.id, refAno: c.refAno, refMes: c.refMes, status: c.status, valorPago: Number(c.valorPago) }));
  const alcance = ocorrenciasDoEscopo(lista, alvo, escopo);

  if (escopo === "ESTA_E_PROXIMAS" && conta.refAno && conta.refMes) {
    const regra = await buscarRegra(empresaId, conta.recorrenciaId);
    if (regra.situacao === "ENCERRADA") throw new ErroRecorrencia(MSG_ENCERRADA, 409);
    const dia = mudanca.dataVencimento ? mudanca.dataVencimento.getDate() : regra.diaVencimento;
    const mudancas = regraDoEscopo(regra as unknown as RegraRecorrencia, { ano: conta.refAno, mes: conta.refMes }, {
      ...(mudanca.valorTotal !== undefined && { valor: mudanca.valorTotal }),
      diaVencimento: dia,
    });
    await prisma.contaPagarRecorrencia.update({
      where: { id: regra.id },
      data: {
        ...(mudancas.valor !== undefined && { valor: mudancas.valor }),
        ...(mudancas.diaVencimento !== undefined && { diaVencimento: mudancas.diaVencimento }),
        inicioAno: mudancas.inicioAno,
        inicioMes: mudancas.inicioMes,
      },
    });
  }

  for (const c of alcance) {
    const venc = mudanca.dataVencimento === undefined ? undefined
      : c.id === conta.id ? mudanca.dataVencimento
      : c.refAno && c.refMes
        ? vencimentoDaOcorrencia({ diaVencimento: mudanca.dataVencimento?.getDate() ?? 1, ajusteDiaNaoUtil: "MANTER" }, c.refAno, c.refMes)
        : undefined;
    const atual = contas.find((x) => x.id === c.id)!;
    const valor = mudanca.valorTotal ?? Number(atual.valorTotal);
    await prisma.contaPagar.update({
      where: { id: c.id },
      data: {
        ...(mudanca.valorTotal !== undefined && { valorTotal: valor, saldoRestante: valor }),
        ...(venc !== undefined && { dataVencimento: venc }),
      },
    });
  }
  return { alcancadas: alcance.length };
}

/* ───────── tornar uma conta avulsa em recorrente ───────── */

/**
 * Pega uma conta que já existe e a transforma na PRIMEIRA ocorrência de uma despesa recorrente:
 * a conta não é recriada (continua com o número, os pagamentos e o histórico dela) — ganha a regra,
 * a competência, e as próximas ocorrências nascem a partir dela.
 */
export async function tornarContaRecorrente(empresaId: string, contaId: string, d: Omit<DadosRecorrencia, "descricao" | "favorecidoNome" | "inicioAno" | "inicioMes"> & Partial<Pick<DadosRecorrencia, "descricao" | "favorecidoNome" | "inicioAno" | "inicioMes">>, usuarioId?: string | null) {
  const conta = await prisma.contaPagar.findFirst({ where: { id: contaId, empresaId } });
  if (!conta) throw new ErroRecorrencia("Conta não encontrada.", 404);
  if (conta.recorrenciaId) throw new ErroRecorrencia(MSG_JA_RECORRENTE, 409);
  if (conta.status === "CANCELADO") throw new ErroRecorrencia("Conta cancelada não vira despesa recorrente.", 409);

  const base = conta.dataVencimento ?? new Date();
  const inicio = { ano: d.inicioAno ?? base.getFullYear(), mes: d.inicioMes ?? base.getMonth() + 1 };
  const { regra } = await criarRecorrencia(empresaId, {
    ...d,
    descricao: d.descricao ?? conta.descricao,
    favorecidoNome: d.favorecidoNome ?? conta.fornecedor,
    fornecedorId: d.fornecedorId ?? conta.fornecedorId,
    tecnicoId: d.tecnicoId ?? conta.tecnicoId,
    categoriaId: d.categoriaId ?? conta.categoriaId,
    centroCustoId: d.centroCustoId ?? conta.centroCustoId,
    formaPagamento: d.formaPagamento ?? conta.formaPagamento,
    valor: d.valor ?? Number(conta.valorTotal),
    inicioAno: inicio.ano,
    inicioMes: inicio.mes,
  }, usuarioId);

  // a conta que já existia passa a ser a ocorrência daquela competência (sem duplicar)
  const duplicada = await prisma.contaPagar.findFirst({
    where: { recorrenciaId: regra.id, refAno: inicio.ano, refMes: inicio.mes },
    select: { id: true },
  });
  if (duplicada) await prisma.contaPagar.delete({ where: { id: duplicada.id } }); // nasceu agora, sem histórico
  await prisma.contaPagar.update({
    where: { id: conta.id },
    data: { recorrenciaId: regra.id, refAno: inicio.ano, refMes: inicio.mes },
  });
  return { regra };
}
