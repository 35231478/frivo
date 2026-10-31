/**
 * Contas a Receber — gestão (servidor). A empresa vem sempre de quem chama (sessão). Não cria conta:
 * onde/quando a conta nasce fica em lib/financeiro-server.ts (gerarContaReceberDoOrcamento /
 * gerarContaReceberDaMedicao).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { origemDaConta } from "@/lib/financeiro/conta-receber-gestao";
import { calcularRetencoes, retencoesDaMedicao } from "@/lib/financeiro/retencoes";
import { rotuloMedicao } from "@/lib/faturamento/fatura";
import { recebidoDaConta, saldoDaConta } from "@/lib/financeiro/parcelas";

type Cliente = Prisma.TransactionClient | typeof prisma;

export async function registrarEventoCR(
  e: { empresaId: string; contaReceberId: string; tipo: string; detalhe?: string | null; usuarioId?: string | null },
  db: Cliente = prisma,
) {
  await db.contaReceberEvento.create({
    data: { empresaId: e.empresaId, contaReceberId: e.contaReceberId, tipo: e.tipo, detalhe: e.detalhe ?? null, usuarioId: e.usuarioId ?? null },
  });
}

/** A conta com o que as regras precisam (status, origem, boleto, notas). Excluída também volta (para recusar com motivo). */
export function contaParaGestao(empresaId: string, id: string) {
  return prisma.contaReceber.findFirst({
    where: { id, empresaId },
    include: { notasFiscais: { select: { status: true } } },
  });
}

/** O que a gaveta precisa da origem (a parcela usa a do lançamento) */
const INCLUDE_ORIGEM = {
      medicao: {
        select: {
          id: true, numero: true, status: true, avulsa: true, valorLiquido: true, valorRetencoes: true,
          retIssAliquota: true, retIrAliquota: true, retPisAliquota: true, retCofinsAliquota: true, retCsllAliquota: true, retInssAliquota: true,
          itens: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, ordemServicoId: true }, orderBy: { ordem: "asc" } },
          relatorios: { select: { id: true, numero: true, ordemServicoId: true } },
        },
      },
      orcamento: {
        select: {
          id: true, codigo: true, nome: true,
          servicos: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true }, orderBy: { ordem: "asc" } },
          produtos: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true }, orderBy: { ordem: "asc" } },
          osGerada: { select: { id: true } },
          ordensServico: { select: { ordemServicoId: true } },
        },
      },
      contrato: { select: { id: true, numero: true } },
      notasFiscais: { select: { id: true, numero: true, status: true }, orderBy: { criadoEm: "asc" } },
} satisfies Prisma.ContaReceberInclude;

/** Detalhes para a gaveta: origem com links, OS ligadas, boleto, notas, parcelas, recebimentos e a linha do tempo. */
export async function detalhesDaConta(empresaId: string, id: string) {
  const conta = await prisma.contaReceber.findFirst({
    where: { id, empresaId, excluidaEm: null },
    include: {
      ...INCLUDE_ORIGEM,
      cliente: { select: { id: true, nome: true, nomeFantasia: true, cpfCnpj: true } },
      categoriaFinanceira: { select: { id: true, nome: true, cor: true, ativo: true } },
      centroCusto: { select: { id: true, nome: true, ativo: true } },
      contaBancaria: { select: { id: true, nome: true, ativo: true } },
      eventos: { orderBy: { criadoEm: "desc" }, take: 50, select: { id: true, tipo: true, detalhe: true, criadoEm: true, usuario: { select: { nome: true } } } },
      recebimentos: {
        orderBy: [{ data: "asc" }, { criadoEm: "asc" }],
        select: { id: true, valor: true, data: true, formaPagamento: true, origem: true, observacao: true, contaBancaria: { select: { nome: true } }, usuario: { select: { nome: true } } },
      },
    },
  });
  if (!conta) return null;
  // Parcela: origem, itens, retenções e notas são os do lançamento (a conta que foi dividida)
  const lanc = conta.lancamentoId
    ? await prisma.contaReceber.findFirst({ where: { id: conta.lancamentoId, empresaId }, include: INCLUDE_ORIGEM })
    : null;
  const c = { ...conta, ...(lanc ? {
    medicaoId: lanc.medicaoId, orcamentoId: lanc.orcamentoId, contratoId: lanc.contratoId,
    medicao: lanc.medicao, orcamento: lanc.orcamento, contrato: lanc.contrato, notasFiscais: lanc.notasFiscais,
  } : {}) };
  // As parcelas do mesmo parcelamento (a parcela vê as irmãs; o lançamento vê todas)
  const grupo = lanc?.id ?? (conta.status === "PARCELADO" ? conta.id : null);
  const parcelas = grupo
    ? await prisma.contaReceber.findMany({
        where: { lancamentoId: grupo, empresaId, excluidaEm: null }, orderBy: { parcelaNumero: "asc" },
        select: { id: true, numero: true, valor: true, valorRecebido: true, status: true, dataVencimento: true, parcelaNumero: true, parcelaTotal: true, boletoStatus: true },
      })
    : [];

  const idsOs = new Set<string>();
  c.medicao?.itens.forEach((i) => i.ordemServicoId && idsOs.add(i.ordemServicoId));
  c.medicao?.relatorios.forEach((r) => idsOs.add(r.ordemServicoId));
  if (c.orcamento?.osGerada) idsOs.add(c.orcamento.osGerada.id);
  c.orcamento?.ordensServico.forEach((v) => idsOs.add(v.ordemServicoId));
  const ordens = idsOs.size
    ? await prisma.ordemServico.findMany({ where: { id: { in: [...idsOs] }, empresaId }, select: { id: true, numero: true }, orderBy: { numero: "asc" } })
    : [];

  const num = (v: unknown) => Number(v ?? 0);
  const itens = c.medicao
    ? c.medicao.itens.map((i) => ({ descricao: i.descricao, quantidade: num(i.quantidade), valorUnitario: num(i.valorUnitario), valorTotal: num(i.valorTotal) }))
    : c.orcamento
      ? [...c.orcamento.servicos, ...c.orcamento.produtos].map((i) => ({ descricao: i.descricao, quantidade: num(i.quantidade), valorUnitario: num(i.valorUnitario), valorTotal: num(i.valorTotal) }))
      : [];

  return {
    id: c.id, numero: c.numero, descricao: c.descricao, valor: num(c.valor), status: c.status,
    // Baixa parcial: quanto entrou e quanto falta; cada recebimento
    valorRecebido: recebidoDaConta(c), saldo: saldoDaConta(c),
    recebimentos: conta.recebimentos.map((r) => ({
      id: r.id, valor: num(r.valor), data: r.data, formaPagamento: r.formaPagamento, origem: r.origem, observacao: r.observacao,
      contaBancaria: r.contaBancaria?.nome ?? null, usuario: r.usuario?.nome ?? null,
    })),
    // Parcelas: a própria (n/N), o lançamento e as irmãs
    parcelaNumero: conta.parcelaNumero, parcelaTotal: conta.parcelaTotal, lancamentoId: conta.lancamentoId,
    lancamento: lanc ? { id: lanc.id, numero: lanc.numero, valor: num(lanc.valor) } : null,
    parcelas: parcelas.map((x) => ({
      id: x.id, numero: x.numero, valor: num(x.valor), status: x.status, dataVencimento: x.dataVencimento,
      parcelaNumero: x.parcelaNumero, parcelaTotal: x.parcelaTotal, boletoStatus: x.boletoStatus,
      valorRecebido: recebidoDaConta(x), saldo: saldoDaConta(x),
    })),
    dataVencimento: c.dataVencimento, dataRecebimento: c.dataRecebimento, criadoEm: c.criadoEm,
    formaPagamento: c.formaPagamento, banco: c.banco, observacao: c.observacao,
    canceladaEm: c.canceladaEm, motivoCancelamento: c.motivoCancelamento,
    categoriaId: c.categoriaId, categoria: c.categoria, categoriaFinanceira: c.categoriaFinanceira,
    centroCusto: c.centroCusto, contaBancaria: c.contaBancaria,
    cliente: { id: c.cliente.id, nome: c.cliente.nomeFantasia ?? c.cliente.nome, cpfCnpj: c.clienteCnpj ?? c.cliente.cpfCnpj },
    origem: origemDaConta(c),
    medicao: c.medicao ? { id: c.medicao.id, numero: c.medicao.numero, rotulo: rotuloMedicao(c.medicao), relatorios: c.medicao.relatorios.map((r) => ({ id: r.id, numero: r.numero })) } : null,
    // Bruto, cada retenção e o líquido — só quando a medição tem retenção marcada
    retencoes: c.medicao && num(c.medicao.valorRetencoes) > 0 ? calcularRetencoes(num(c.medicao.valorLiquido), retencoesDaMedicao(c.medicao)) : null,
    orcamento: c.orcamento ? { id: c.orcamento.id, codigo: c.orcamento.codigo, nome: c.orcamento.nome } : null,
    contrato: c.contrato,
    ordens,
    itens,
    boleto: c.boletoStatus ? {
      status: c.boletoStatus, emitidoEm: c.boletoEmitidoEm, vencimento: c.boletoVencimento,
      linhaDigitavel: c.boletoLinhaDigitavel ?? c.boletoCodigoBarras, temPdf: !!c.boletoId,
    } : null,
    notas: c.notasFiscais,
    notificacaoEnviadaEm: c.notificacaoEnviadaEm,
    eventos: conta.eventos.map((e) => ({ id: e.id, tipo: e.tipo, detalhe: e.detalhe, criadoEm: e.criadoEm, usuario: e.usuario?.nome ?? null })),
    notasParaRegra: c.notasFiscais.map((n) => ({ status: n.status })),
    medicaoId: c.medicaoId, orcamentoId: c.orcamentoId, contratoId: c.contratoId, boletoStatus: c.boletoStatus,
  };
}

export interface ContaResumo {
  id: string; numero: string; valor: number; status: string; dataVencimento: Date | null;
  valorRecebido: number; parcelaNumero: number | null; parcelaTotal: number | null;
}

const RESUMO = { id: true, numero: true, valor: true, status: true, dataVencimento: true, valorRecebido: true, parcelaNumero: true, parcelaTotal: true } as const;
type LinhaResumo = { id: string; numero: string; valor: unknown; status: string; dataVencimento: Date | null; valorRecebido: unknown; parcelaNumero: number | null; parcelaTotal: number | null };

/** A conta parcelada (o lançamento) aparece pelas parcelas dela — são elas as cobranças */
async function resumir(xs: LinhaResumo[]): Promise<ContaResumo[]> {
  const lancamentos = xs.filter((x) => x.status === "PARCELADO").map((x) => x.id);
  const parcelas = lancamentos.length
    ? await prisma.contaReceber.findMany({ where: { lancamentoId: { in: lancamentos }, excluidaEm: null }, select: { ...RESUMO, lancamentoId: true }, orderBy: [{ parcelaNumero: "asc" }] })
    : [];
  const linhas = xs.flatMap((x) => (x.status === "PARCELADO" ? parcelas.filter((p) => p.lancamentoId === x.id) : [x]));
  return linhas.map((x) => ({
    id: x.id, numero: x.numero, valor: Number(x.valor), status: x.status, dataVencimento: x.dataVencimento,
    valorRecebido: Number(x.valorRecebido), parcelaNumero: x.parcelaNumero, parcelaTotal: x.parcelaTotal,
  }));
}

/** Contas a receber de um orçamento, de uma medição ou de uma OS (pela medição ou pelo orçamento ligado). */
export async function contasVinculadas(empresaId: string, de: { orcamentoId?: string; medicaoId?: string; ordemServicoId?: string }): Promise<ContaResumo[]> {
  const base = { empresaId, excluidaEm: null };
  if (de.orcamentoId) return await resumir(await prisma.contaReceber.findMany({ where: { ...base, orcamentoId: de.orcamentoId }, select: RESUMO, orderBy: { criadoEm: "asc" } }));
  if (de.medicaoId) return await resumir(await prisma.contaReceber.findMany({ where: { ...base, medicaoId: de.medicaoId }, select: RESUMO, orderBy: { criadoEm: "asc" } }));
  if (de.ordemServicoId) {
    const os = de.ordemServicoId;
    return await resumir(await prisma.contaReceber.findMany({
      where: {
        ...base,
        OR: [
          { medicao: { itens: { some: { ordemServicoId: os } } } },
          { medicao: { relatorios: { some: { ordemServicoId: os } } } },
          { orcamento: { ordensServico: { some: { ordemServicoId: os } } } },
          { orcamento: { osGerada: { id: os } } },
        ],
      },
      select: RESUMO, orderBy: { criadoEm: "asc" },
    }));
  }
  return [];
}
