/**
 * Tela "Faturamento de contratos": uma linha por contrato com faturamento automático (e por execução
 * da competência de contrato que já foi automático). Mostra a etapa, a medição, a NF, o boleto e o erro.
 * Sempre da empresa da sessão.
 */
import { prisma } from "@/lib/prisma";
import { contratoCobraNaCompetencia, passoCobranca, textoFrequencia, valorMensalDe } from "@/lib/financeiro/contrato-previsao";
import { diaDeFaturar } from "@/lib/faturamento/rotina-contratos";

export type LinhaFaturamentoContrato = {
  contratoId: string; contratoNumero: string; cliente: string; valor: number; frequencia: string; aprovacaoAutomatica: boolean;
  /** Sem execução: o que esperar ("Fatura no dia 10", "Sem cobrança neste mês") */
  previsto: string | null;
  execucao: null | {
    id: string; etapa: string; situacao: string; erro: string | null; tentativas: number; atualizadoEm: string;
    medicao: null | { id: string; numero: string; status: string; nfNumero: string | null };
    boleto: string | null;
  };
};

export type ResumoFaturamentoContratos = { contratos: number; concluidas: number; andamento: number; atencao: number };

export async function painelFaturamentoContratos(empresaId: string, ano: number, mes: number) {
  const [contratos, execucoes] = await Promise.all([
    prisma.contrato.findMany({
      where: { empresaId, status: "ATIVO", faturamentoAutomatico: true },
      select: {
        id: true, numero: true, valorMensal: true, periodicidade: true, aprovacaoAutomatica: true, dataInicio: true, dataFim: true,
        diaFaturamento: true, diaFixoMes: true, diaVencimento: true, cliente: { select: { nome: true, nomeFantasia: true, diaFaturamento: true } },
      },
      orderBy: { numero: "asc" },
    }),
    prisma.faturamentoContratoExecucao.findMany({
      where: { empresaId, refAno: ano, refMes: mes },
      include: {
        contrato: {
          select: {
            id: true, numero: true, valorMensal: true, periodicidade: true, aprovacaoAutomatica: true,
            cliente: { select: { nome: true, nomeFantasia: true } },
          },
        },
        medicao: {
          select: {
            id: true, numero: true, status: true, nfNumero: true,
            contasReceber: { where: { status: { not: "CANCELADO" }, excluidaEm: null }, select: { boletoStatus: true }, take: 1, orderBy: { criadoEm: "asc" } },
          },
        },
      },
    }),
  ]);

  const porContrato = new Map(execucoes.map((e) => [e.contratoId, e]));
  const linhas: LinhaFaturamentoContrato[] = [];
  const vistos = new Set<string>();
  const linhaDe = (c: { id: string; numero: string; valorMensal: unknown; periodicidade: string | null; aprovacaoAutomatica: boolean; cliente: { nome: string; nomeFantasia: string | null } }, previsto: string | null) => {
    const e = porContrato.get(c.id);
    vistos.add(c.id);
    linhas.push({
      contratoId: c.id, contratoNumero: c.numero, cliente: c.cliente.nomeFantasia ?? c.cliente.nome, valor: valorMensalDe(c),
      frequencia: textoFrequencia(passoCobranca(c.periodicidade)), aprovacaoAutomatica: c.aprovacaoAutomatica,
      previsto: e ? null : previsto,
      execucao: e ? {
        id: e.id, etapa: e.etapa, situacao: e.situacao, erro: e.erro, tentativas: e.tentativas, atualizadoEm: e.atualizadoEm.toISOString(),
        medicao: e.medicao ? { id: e.medicao.id, numero: e.medicao.numero, status: e.medicao.status, nfNumero: e.medicao.nfNumero } : null,
        boleto: e.medicao?.contasReceber[0]?.boletoStatus ?? null,
      } : null,
    });
  };

  for (const c of contratos) {
    const cobra = contratoCobraNaCompetencia(c.dataInicio, c.dataFim, ano, mes, passoCobranca(c.periodicidade));
    linhaDe(c, cobra ? `Fatura no dia ${diaDeFaturar(c, ano, mes, c.cliente.diaFaturamento)}` : "Sem cobrança neste mês");
  }
  // Execuções de contratos que deixaram de ser automáticos (ou de estar ativos) continuam visíveis
  for (const e of execucoes) if (!vistos.has(e.contratoId)) linhaDe(e.contrato, null);

  const resumo: ResumoFaturamentoContratos = {
    contratos: linhas.length,
    concluidas: linhas.filter((l) => l.execucao?.situacao === "CONCLUIDA").length,
    andamento: linhas.filter((l) => l.execucao && ["PENDENTE", "AGUARDANDO"].includes(l.execucao.situacao)).length,
    atencao: linhas.filter((l) => l.execucao && ["FALHA", "PENDENCIA"].includes(l.execucao.situacao)).length,
  };
  return { ano, mes, linhas, resumo };
}

/** Sino: execuções que pedem alguém (falhou 3× ou pendência) — de qualquer competência */
export const contarAtencaoFaturamento = (empresaId: string) =>
  prisma.faturamentoContratoExecucao.count({ where: { empresaId, situacao: { in: ["FALHA", "PENDENCIA"] } } });
