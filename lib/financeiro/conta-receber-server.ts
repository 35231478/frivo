/**
 * Contas a Receber — gestão (servidor). A empresa vem sempre de quem chama (sessão). Não cria conta:
 * onde/quando a conta nasce fica em lib/financeiro-server.ts (gerarContaReceberDoOrcamento /
 * gerarContaReceberDaMedicao).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { origemDaConta } from "@/lib/financeiro/conta-receber-gestao";
import { calcularRetencoes, retencoesDaMedicao } from "@/lib/financeiro/retencoes";

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

/** Detalhes para a gaveta: origem com links, OS ligadas, boleto, notas e a linha do tempo. */
export async function detalhesDaConta(empresaId: string, id: string) {
  const c = await prisma.contaReceber.findFirst({
    where: { id, empresaId, excluidaEm: null },
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true, cpfCnpj: true } },
      categoriaFinanceira: { select: { id: true, nome: true, cor: true, ativo: true } },
      centroCusto: { select: { id: true, nome: true, ativo: true } },
      contaBancaria: { select: { id: true, nome: true, ativo: true } },
      medicao: {
        select: {
          id: true, numero: true, status: true, valorLiquido: true, valorRetencoes: true,
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
      eventos: { orderBy: { criadoEm: "desc" }, take: 50, select: { id: true, tipo: true, detalhe: true, criadoEm: true, usuario: { select: { nome: true } } } },
    },
  });
  if (!c) return null;

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
    dataVencimento: c.dataVencimento, dataRecebimento: c.dataRecebimento, criadoEm: c.criadoEm,
    formaPagamento: c.formaPagamento, banco: c.banco, observacao: c.observacao,
    canceladaEm: c.canceladaEm, motivoCancelamento: c.motivoCancelamento,
    categoriaId: c.categoriaId, categoria: c.categoria, categoriaFinanceira: c.categoriaFinanceira,
    centroCusto: c.centroCusto, contaBancaria: c.contaBancaria,
    cliente: { id: c.cliente.id, nome: c.cliente.nomeFantasia ?? c.cliente.nome, cpfCnpj: c.clienteCnpj ?? c.cliente.cpfCnpj },
    origem: origemDaConta(c),
    medicao: c.medicao ? { id: c.medicao.id, numero: c.medicao.numero, relatorios: c.medicao.relatorios.map((r) => ({ id: r.id, numero: r.numero })) } : null,
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
    eventos: c.eventos.map((e) => ({ id: e.id, tipo: e.tipo, detalhe: e.detalhe, criadoEm: e.criadoEm, usuario: e.usuario?.nome ?? null })),
    notasParaRegra: c.notasFiscais.map((n) => ({ status: n.status })),
    medicaoId: c.medicaoId, orcamentoId: c.orcamentoId, contratoId: c.contratoId, boletoStatus: c.boletoStatus,
  };
}

export interface ContaResumo { id: string; numero: string; valor: number; status: string; dataVencimento: Date | null }

const RESUMO = { id: true, numero: true, valor: true, status: true, dataVencimento: true } as const;
const resumir = (xs: { id: string; numero: string; valor: unknown; status: string; dataVencimento: Date | null }[]): ContaResumo[] =>
  xs.map((x) => ({ ...x, valor: Number(x.valor) }));

/** Contas a receber de um orçamento, de uma medição ou de uma OS (pela medição ou pelo orçamento ligado). */
export async function contasVinculadas(empresaId: string, de: { orcamentoId?: string; medicaoId?: string; ordemServicoId?: string }): Promise<ContaResumo[]> {
  const base = { empresaId, excluidaEm: null };
  if (de.orcamentoId) return resumir(await prisma.contaReceber.findMany({ where: { ...base, orcamentoId: de.orcamentoId }, select: RESUMO, orderBy: { criadoEm: "asc" } }));
  if (de.medicaoId) return resumir(await prisma.contaReceber.findMany({ where: { ...base, medicaoId: de.medicaoId }, select: RESUMO, orderBy: { criadoEm: "asc" } }));
  if (de.ordemServicoId) {
    const os = de.ordemServicoId;
    return resumir(await prisma.contaReceber.findMany({
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
