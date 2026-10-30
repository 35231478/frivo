/**
 * "A faturar" (Opção A, P3) — a nova fonte da previsão dos orçamentos, sem tabela nova.
 *
 * Desde a P2 a aprovação não cria mais conta a receber: o orçamento APROVADO fica "a faturar" até o
 * "Faturar" (a cobrança nasce na fatura/medição). Para o painel não perder esse dinheiro, a previsão
 * passa a vir daqui:
 *  - orçamentos COMUM APROVADOS com SALDO a faturar = totalGeral − já faturado. Sem faturamento
 *    parcial (P5) o "já faturado" é sim/não — a mesma regra das travas (orcamentoJaFaturado: direto
 *    ou pela OS gerada, em medição/fatura viva) —, então o saldo é o total ou zero;
 *  - transição segura: orçamento que ainda tem a conta Prevista antiga (criada na aprovação antes da
 *    Opção A) NÃO entra — ela já está no Contas a Receber; contar os dois seria contar em dobro;
 *  - mês da previsão: a previsão de conclusão da OS gerada do orçamento; sem OS (ou sem previsão),
 *    o mês corrente (D2: "para faturar agora"). Previsão já passada e ainda não faturado também cai
 *    no mês corrente — o dinheiro continua a faturar, não some num mês que já passou.
 */
import { prisma } from "@/lib/prisma";
import { partesBR } from "@/lib/fuso";
import { orcamentoJaFaturado } from "@/lib/faturamento-os";

export interface ItemAFaturar {
  orcamentoId: string; codigo: string; nome: string; clienteNome: string;
  valor: number;
  /** Mês da previsão, "AAAA-MM" (Brasília) */
  mes: string;
  /** De onde veio o mês: previsão de conclusão da OS gerada, ou o mês corrente */
  origemMes: "OS" | "MES_CORRENTE";
  osNumero: string | null;
}

/** "AAAA-MM" de um instante, no calendário de Brasília */
export function chaveMesBR(d: Date | string) {
  const p = partesBR(d);
  return `${p.ano}-${String(p.mes + 1).padStart(2, "0")}`;
}

/**
 * Mês da previsão de um orçamento a faturar (regra pura): a previsão de conclusão da OS gerada
 * (OS viva); sem ela — ou se já passou — o mês corrente.
 */
export function mesDaPrevisao(os: { previsaoConclusao: Date | string | null; status: string } | null, agora = new Date()): { mes: string; origem: ItemAFaturar["origemMes"] } {
  const atual = chaveMesBR(agora);
  if (os && os.status !== "CANCELADA" && os.previsaoConclusao) {
    const m = chaveMesBR(os.previsaoConclusao);
    if (m >= atual) return { mes: m, origem: "OS" };
  }
  return { mes: atual, origem: "MES_CORRENTE" };
}

/** Todos os orçamentos a faturar da empresa (com o mês de cada um) */
export async function itensAFaturar(empresaId: string, agora = new Date()): Promise<ItemAFaturar[]> {
  const candidatos = await prisma.orcamento.findMany({
    where: {
      empresaId, tipo: "COMUM", status: "APROVADO",
      // transição: quem ainda tem a Prevista antiga (ou qualquer conta viva) já está no Contas a Receber
      contasReceber: { none: { status: { not: "CANCELADO" }, excluidaEm: null } },
    },
    select: {
      id: true, codigo: true, nome: true, totalGeral: true,
      cliente: { select: { nome: true, nomeFantasia: true } },
      osGerada: { select: { numero: true, chamadoNumero: true, previsaoConclusao: true, status: true } },
    },
    orderBy: { codigo: "asc" },
  });
  const itens: ItemAFaturar[] = [];
  for (const o of candidatos) {
    const valor = Number(o.totalGeral);
    if (valor <= 0) continue;
    if (await orcamentoJaFaturado(o.id)) continue; // já faturado: saldo zero (sem parcial até a P5)
    const { mes, origem } = mesDaPrevisao(o.osGerada, agora);
    itens.push({
      orcamentoId: o.id, codigo: o.codigo, nome: o.nome, clienteNome: o.cliente.nomeFantasia ?? o.cliente.nome,
      valor, mes, origemMes: origem, osNumero: o.osGerada ? o.osGerada.chamadoNumero ?? o.osGerada.numero : null,
    });
  }
  return itens;
}

/** A faturar num período de meses ("AAAA-MM", inclusive): soma, quantidade e os orçamentos */
export async function aFaturar(empresaId: string, periodo: { de: string; ate: string }, agora = new Date()) {
  const itens = (await itensAFaturar(empresaId, agora)).filter((i) => i.mes >= periodo.de && i.mes <= periodo.ate);
  return { valor: Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100, qtd: itens.length, itens };
}
