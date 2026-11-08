/**
 * "Faturar" (faturamento avulso) — servidor. A empresa vem sempre de quem chama (sessão).
 * Reusa a engine da medição: cria a Medicao ADICIONAL marcada `avulsa`, já LIBERADA para a nota
 * (sem a aprovação do cliente, D3), com os itens ligados à origem, e gera a conta a receber pelo
 * líquido (gerarContaReceberDaMedicao — a previsão do orçamento vira a cobrança, sem duplicar).
 * Travas C6/C7: origem trancada na transação (travarOrigens) e o saldo lido ali dentro.
 * Retenções: herdadas do cadastro dos serviços da nota (ajustáveis depois no "Editar").
 *
 * P5 — faturamento parcial: "Faturar parcial" fatura PARTE da origem (valor ou percentual do total); cada parte é
 * uma fatura própria (número, NFS-e, conta a receber, retenções sobre a parte). O "Faturar" (tudo) fatura o saldo:
 * sem parcial antes, é a fatura cheia de sempre; depois de uma parcial, é o resto (também marcado parcial).
 * Saldo zerado → "existente" (abre a última fatura). Cancelar uma fatura devolve o valor dela ao saldo sozinho:
 * o faturado é a soma das faturas vivas.
 */

import { prisma } from "@/lib/prisma";
import { gerarContaReceberDaMedicao } from "@/lib/financeiro-server";
import { ErroConta, parcelarConta } from "@/lib/financeiro/parcelas-server";
import { dividirEmParcelas, MAX_PARCELAS } from "@/lib/financeiro/parcelas";
import { faturamentoDaOrigem, itensFaturaveisDaOs, travarOrigens } from "@/lib/faturamento-os";
import { registrarEvento } from "@/lib/orcamentos/ciclo-server";
import { chaveDiaCivil, chaveHojeBR, partesBR } from "@/lib/fuso";
import { retencoesHerdadas } from "@/lib/financeiro/retencoes-server";
import { proximoNumero } from "@/lib/numeracao-server";
import {
  faturaDaOs, faturaDoOrcamento, faturaParcial, motivoNaoFaturarOrcamento, motivoNaoFaturarOs, numeroFatura, percentualDoTotal,
  rotuloParcial, validarParcial, vencimentoAvulso, type Fatura, type PedidoParcial,
} from "@/lib/faturamento/fatura";

export interface FaturaResumo { id: string; numero: string }
export interface ParteFaturada { percentual: number; valor: number; saldoRestante: number }
export type ResultadoFaturar =
  | { tipo: "nao-encontrado" }
  | { tipo: "bloqueado"; erro: string }
  | { tipo: "vazio"; erro: string }
  | { tipo: "existente"; fatura: FaturaResumo }
  | { tipo: "criada"; fatura: FaturaResumo; parcelas?: number; avisoParcelas?: string; parcial?: ParteFaturada };

/** "Faturar em N×": o servidor divide o valor FINAL da conta (líquido − retenções) a partir do 1º vencimento */
export interface ParcelamentoFaturar {
  quantidade: number;
  /** Sem data: o vencimento da fatura (dia de faturamento do cliente), senão daqui a 30 dias */
  primeiroVencimento?: string | null;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
interface Origem {
  empresaId: string;
  usuarioId: string;
  clienteId: string;
  diaFaturamento: number | null;
  /** Descrição da fatura cheia ("Orçamento ORC-… — nome" / "OS … — título") */
  descricao: string;
  /** A fatura CHEIA de hoje (o total da origem é o líquido dela) */
  fatura: Fatura;
  origem: { orcamentoId?: string; osId?: string };
  /** Registro na origem (histórico da OS / linha do tempo do orçamento), dentro da transação */
  registrar: (tx: Tx, numero: string, detalhe: string) => Promise<unknown>;
  parcelamento?: ParcelamentoFaturar | null;
  /** "Faturar parcial": a parte pedida (valor ou percentual do total). Ausente = "Faturar" (o saldo) */
  parcial?: PedidoParcial | null;
}

async function criarFatura(o: Origem): Promise<ResultadoFaturar> {
  const agora = partesBR();
  const r = await prisma.$transaction(async (tx) => {
    await travarOrigens(tx, { osIds: o.origem.osId ? [o.origem.osId] : [], orcamentoIds: o.origem.orcamentoId ? [o.origem.orcamentoId] : [] });
    const fat = await faturamentoDaOrigem(tx, o.origem, o.fatura.valorLiquido);
    // Medição de contrato/manual viva cobrindo a origem, ou saldo zerado: leva à existente (nunca cobra 2×)
    if (fat.outra) return { tipo: "existente" as const, fatura: { id: fat.outra.id, numero: fat.outra.numero } };
    if (fat.saldo <= 0 && fat.ultima) return { tipo: "existente" as const, fatura: { id: fat.ultima.id, numero: fat.ultima.numero } };

    // Quanto desta vez: a parte pedida (validada contra o saldo) ou o saldo inteiro
    let valor = fat.saldo;
    if (o.parcial) {
      const v = validarParcial({ total: fat.total, saldo: fat.saldo }, o.parcial);
      if (!v.ok) return { tipo: "bloqueado" as const, erro: v.erro };
      valor = v.valor;
    }
    // É parcial quando não fecha a origem inteira de uma vez (parte pedida menor que o saldo, ou já houve parte antes)
    const ehParcial = valor < fat.saldo - 0.005 || fat.faturado > 0;
    const percentual = percentualDoTotal(valor, fat.total);
    const fatura = ehParcial ? faturaParcial(o.fatura, valor, rotuloParcial(percentual)) : o.fatura;
    if (!fatura.linhas.length || fatura.valorLiquido <= 0) return { tipo: "vazio" as const, erro: "Nada a faturar nesta parte." };
    const descricao = (ehParcial ? `Parcial ${rotuloParcial(percentual).replace(/^parcial /, "")} — ${o.descricao}` : o.descricao).slice(0, 300);
    // Retenções herdadas dos serviços, sobre o valor desta fatura (parcial: proporcional, pela mesma regra)
    const ret = await retencoesHerdadas(o.empresaId, { valorTotal: fatura.valorTotal, valorLiquido: fatura.valorLiquido, linhas: fatura.linhas });

    // Número pelo contador da empresa, sob trava (a mesma de toda medição/fatura)
    const numero = await proximoNumero(tx, o.empresaId, "medicao");
    const criada = await tx.medicao.create({
      data: {
        empresaId: o.empresaId, clienteId: o.clienteId, numero, tipo: "ADICIONAL", avulsa: true,
        faturaParcial: ehParcial, percentualFaturado: ehParcial ? percentual : null,
        mes: agora.mes + 1, ano: agora.ano, descricao,
        // D3: o avulso vai direto para a nota (a aprovação do cliente é só da medição de contrato)
        status: "PC_RECEBIDO", dataAprovacao: new Date(),
        dataVencimento: vencimentoAvulso(o.diaFaturamento, { ano: agora.ano, mes0: agora.mes, dia: agora.dia }),
        valorTotal: fatura.valorTotal, descontoValor: fatura.descontoValor, valorLiquido: fatura.valorLiquido,
        // Retenções herdadas dos serviços: a conta a receber/boleto sai pelo líquido
        ...ret.campos, valorRetencoes: ret.total,
        tokenPublico: crypto.randomUUID(),
        itens: {
          create: fatura.linhas.map((l, ordem) => ({
            tipo: l.tipo, descricao: l.descricao, quantidade: l.quantidade, valorUnitario: l.valorUnitario, valorTotal: l.valorTotal,
            servicoId: l.servicoId ?? null, produtoId: l.produtoId ?? null, orcamentoId: l.orcamentoId ?? null,
            ordemServicoId: l.ordemServicoId ?? null, ordem,
          })),
        },
      },
      select: { id: true, numero: true },
    });
    const saldoRestante = Math.round((fat.saldo - fatura.valorLiquido) * 100) / 100;
    await o.registrar(tx, criada.numero, `Fatura ${numeroFatura(criada.numero)}${ehParcial ? ` (${rotuloParcial(percentual)})` : ""}`);
    return {
      tipo: "criada" as const, fatura: criada,
      ...(ehParcial ? { parcial: { percentual, valor: fatura.valorLiquido, saldoRestante } } : {}),
    };
  }, { timeout: 20_000 });

  // A cobrança: conta a receber pelo líquido (a previsão do orçamento, se houver, vira esta conta)
  if (r.tipo !== "criada") return r;
  const conta = await gerarContaReceberDaMedicao(r.fatura.id);
  // Parcelada no próprio Faturar: o valor final da conta dividido em N parcelas mensais. A fatura já
  // existe: se o parcelamento for recusado, ela fica inteira e o aviso volta para a tela
  const parc = o.parcelamento;
  if (conta && parc && parc.quantidade > 1) {
    try {
      const qtd = Math.min(MAX_PARCELAS, Math.floor(parc.quantidade));
      await prisma.$transaction((tx) => parcelarConta(tx, {
        empresaId: o.empresaId, contaId: conta.id, usuarioId: o.usuarioId,
        parcelas: dividirEmParcelas(Number(conta.valor), qtd, parc.primeiroVencimento || (conta.dataVencimento ? chaveDiaCivil(conta.dataVencimento) : chaveHojeBR(30))),
      }), { timeout: 20_000 });
      return { ...r, parcelas: qtd };
    } catch (e) {
      if (!(e instanceof ErroConta)) throw e;
      return { ...r, avisoParcelas: `Fatura criada sem parcelar: ${e.message}` };
    }
  }
  return r;
}

const SELECT_ORC = {
  id: true, codigo: true, nome: true, status: true, tipo: true, clienteId: true,
  descontoServicos: true, tipoDescontoServicos: true, descontoProdutos: true, tipoDescontoProdutos: true, issAliquota: true,
  cliente: { select: { diaFaturamento: true } },
  servicos: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, ordem: true, servicoId: true } },
  produtos: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, ordem: true, produtoId: true } },
} as const;

/** Faturar o orçamento aprovado (com ou sem OS): os itens como o cliente aprovou. `parcial`: só a parte pedida */
export async function faturarOrcamento(p: { empresaId: string; usuarioId: string; orcamentoId: string; parcelamento?: ParcelamentoFaturar | null; parcial?: PedidoParcial | null }): Promise<ResultadoFaturar> {
  const orc = await prisma.orcamento.findFirst({ where: { id: p.orcamentoId, empresaId: p.empresaId }, select: SELECT_ORC });
  if (!orc) return { tipo: "nao-encontrado" };
  const fatura = faturaDoOrcamento(orc);
  // Já faturado por inteiro (direto ou pela OS gerada dele): leva à fatura, antes de qualquer outra regra
  const fat = await faturamentoDaOrigem(prisma, { orcamentoId: orc.id }, fatura.valorLiquido);
  if (fat.outra) return { tipo: "existente", fatura: { id: fat.outra.id, numero: fat.outra.numero } };
  if (fat.saldo <= 0 && fat.ultima) return { tipo: "existente", fatura: { id: fat.ultima.id, numero: fat.ultima.numero } };
  const motivo = motivoNaoFaturarOrcamento(orc);
  if (motivo) return { tipo: "bloqueado", erro: motivo };
  if (!fatura.linhas.length || fatura.valorLiquido <= 0) return { tipo: "vazio", erro: "Nada a faturar: o orçamento não tem itens com valor." };
  return criarFatura({
    empresaId: p.empresaId, usuarioId: p.usuarioId, clienteId: orc.clienteId, diaFaturamento: orc.cliente.diaFaturamento,
    descricao: `Orçamento ${orc.codigo} — ${orc.nome}`.slice(0, 300), fatura, origem: { orcamentoId: orc.id },
    parcelamento: p.parcelamento, parcial: p.parcial,
    registrar: (tx, _numero, detalhe) => registrarEvento({ empresaId: p.empresaId, orcamentoId: orc.id, tipo: "FATURADO", detalhe, usuarioId: p.usuarioId }, tx),
  });
}

/** Faturar a OS concluída (sem contrato): itens executados + adicionais "Cobrar" com preço. `parcial`: só a parte pedida */
export async function faturarOs(p: { empresaId: string; usuarioId: string; osId: string; parcelamento?: ParcelamentoFaturar | null; parcial?: PedidoParcial | null }): Promise<ResultadoFaturar> {
  const os = await prisma.ordemServico.findFirst({
    where: { id: p.osId, empresaId: p.empresaId },
    select: { id: true, numero: true, status: true, contratoId: true, clienteId: true, descricao: true, cliente: { select: { diaFaturamento: true } } },
  });
  if (!os) return { tipo: "nao-encontrado" };
  const { itens, adicionais } = await itensFaturaveisDaOs(os.id);
  // O serviço do catálogo: o do orçamento de origem ou o próprio da OS avulsa (E3.3b)
  const fatura = faturaDaOs(os.id, itens.map((i) => ({ ...i, servicoId: i.orcamentoServico?.servicoId ?? i.servicoId ?? null })), adicionais.map((a) => ({ descricao: a.descricao, valor: a.valor })));
  // Já faturada por inteiro (a OS passa a "Faturada" depois): leva à fatura, antes de qualquer outra regra
  const fat = await faturamentoDaOrigem(prisma, { osId: os.id }, fatura.valorLiquido);
  if (fat.outra) return { tipo: "existente", fatura: { id: fat.outra.id, numero: fat.outra.numero } };
  if (fat.saldo <= 0 && fat.ultima) return { tipo: "existente", fatura: { id: fat.ultima.id, numero: fat.ultima.numero } };
  const motivo = motivoNaoFaturarOs(os);
  if (motivo) return { tipo: "bloqueado", erro: motivo };
  if (!fatura.linhas.length || fatura.valorLiquido <= 0) {
    return { tipo: "vazio", erro: "Nada a faturar: marque os itens executados (ou os adicionais \"Cobrar\" com preço)." };
  }
  const titulo = (os.descricao ?? "").split("\n")[0].trim();
  return criarFatura({
    empresaId: p.empresaId, usuarioId: p.usuarioId, clienteId: os.clienteId, diaFaturamento: os.cliente.diaFaturamento,
    descricao: `OS ${os.numero}${titulo ? ` — ${titulo}` : ""}`.slice(0, 300), fatura, origem: { osId: os.id },
    parcelamento: p.parcelamento, parcial: p.parcial,
    registrar: (tx, _numero, detalhe) => tx.osHistorico.create({
      data: { ordemServicoId: os.id, usuarioId: p.usuarioId, acao: "OS faturada", detalhes: detalhe },
    }),
  });
}

/** O faturamento da origem para a tela (orçamento): total da fatura cheia, faturado, saldo e as faturas */
export async function faturamentoDoOrcamento(orcamentoId: string, empresaId: string) {
  const orc = await prisma.orcamento.findFirst({ where: { id: orcamentoId, empresaId }, select: SELECT_ORC });
  if (!orc) return null;
  const total = orc.tipo === "COMUM" ? faturaDoOrcamento(orc).valorLiquido : 0;
  return faturamentoDaOrigem(prisma, { orcamentoId }, total);
}

/** O faturamento da origem para a tela (OS avulsa): total = itens executados + adicionais "Cobrar" de hoje */
export async function faturamentoDaOs(osId: string) {
  const { itens, adicionais } = await itensFaturaveisDaOs(osId);
  const total = faturaDaOs(osId, itens.map((i) => ({ ...i, servicoId: i.orcamentoServico?.servicoId ?? i.servicoId ?? null })), adicionais.map((a) => ({ descricao: a.descricao, valor: a.valor }))).valorLiquido;
  return faturamentoDaOrigem(prisma, { osId }, total);
}
