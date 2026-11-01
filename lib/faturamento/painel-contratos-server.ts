/**
 * Tela "Faturamento de contratos": uma linha por contrato com faturamento automático (e por execução
 * da competência de contrato que já foi automático). Mostra a etapa, a medição, a NF, o boleto e o erro.
 * Sempre da empresa da sessão.
 */
import { prisma } from "@/lib/prisma";
import { contratoCobraNaCompetencia, passoCobranca, textoFrequencia, valorMensalDe } from "@/lib/financeiro/contrato-previsao";
import { diaDeFaturar } from "@/lib/faturamento/rotina-contratos";

export type NfTela = null | { numero: string | null; situacao: "AUTORIZADA" | "PREFEITURA" | "NAO_ACEITA" | "MANUAL" };

export type LinhaFaturamentoContrato = {
  contratoId: string; contratoNumero: string; cliente: string; valor: number; frequencia: string; aprovacaoAutomatica: boolean;
  /** Sem execução: o que esperar ("Fatura no dia 10", "Sem cobrança neste mês") */
  previsto: string | null;
  execucao: null | {
    id: string; etapa: string; situacao: string; erro: string | null; tentativas: number; atualizadoEm: string;
    medicao: null | { id: string; numero: string; status: string; nfNumero: string | null };
    /** A NFS-e da medição: a mais recente (nº quando autorizada; na prefeitura; não aceita) ou a NF registrada à mão */
    nf: NfTela;
    /** As cobranças da medição (conta ou parcelas) com o boleto de cada uma */
    cobrancas: { id: string; numero: string; boleto: string | null }[];
  };
};

/** A NF que a tela mostra: a autorizada mais recente; senão a que está na prefeitura; senão a não aceita; senão a manual */
export function nfDaMedicao(notas: { status: string; numero: string | null }[], nfManual: string | null): NfTela {
  const autorizada = notas.find((n) => n.status === "CONCLUIDO");
  if (autorizada) return { numero: autorizada.numero, situacao: "AUTORIZADA" };
  if (notas.some((n) => n.status === "ENVIANDO" || n.status === "PROCESSANDO")) return { numero: null, situacao: "PREFEITURA" };
  if (notas.some((n) => n.status === "REJEITADO" || n.status === "INTERROMPIDO")) return { numero: null, situacao: "NAO_ACEITA" };
  return nfManual ? { numero: nfManual, situacao: "MANUAL" } : null;
}

type Cartao = { q: number; v: number };
export type ResumoFaturamentoContratos = { contratos: Cartao; concluidas: Cartao; andamento: Cartao; atencao: Cartao };

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
            notasFiscais: { select: { status: true, numero: true }, orderBy: { criadoEm: "desc" } },
          },
        },
      },
    }),
  ]);

  // As cobranças das medições (a conta, ou as parcelas dela) com o boleto de cada uma
  const medicaoIds = execucoes.map((e) => e.medicaoId).filter(Boolean) as string[];
  const contas = medicaoIds.length ? await prisma.contaReceber.findMany({
    where: {
      empresaId, excluidaEm: null, status: { notIn: ["PREVISTO", "CANCELADO", "PARCELADO"] }, // previsão ainda não se cobra
      OR: [{ medicaoId: { in: medicaoIds } }, { lancamento: { medicaoId: { in: medicaoIds } } }],
    },
    select: { id: true, numero: true, boletoStatus: true, medicaoId: true, lancamento: { select: { medicaoId: true } } },
    orderBy: [{ parcelaNumero: "asc" }, { criadoEm: "asc" }],
  }) : [];
  const cobrancasDe = (medicaoId: string | null) => contas
    .filter((c) => medicaoId && (c.medicaoId === medicaoId || c.lancamento?.medicaoId === medicaoId))
    .map((c) => ({ id: c.id, numero: c.numero, boleto: c.boletoStatus ?? null }));

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
        // NF manual: o nº registrado na medição que não é de nota emitida aqui
        nf: e.medicao ? nfDaMedicao(e.medicao.notasFiscais, e.medicao.notasFiscais.length ? null : e.medicao.nfNumero) : null,
        cobrancas: cobrancasDe(e.medicaoId),
      } : null,
    });
  };

  for (const c of contratos) {
    const cobra = contratoCobraNaCompetencia(c.dataInicio, c.dataFim, ano, mes, passoCobranca(c.periodicidade));
    linhaDe(c, cobra ? `Fatura no dia ${diaDeFaturar(c, ano, mes, c.cliente.diaFaturamento)}` : "Sem cobrança neste mês");
  }
  // Execuções de contratos que deixaram de ser automáticos (ou de estar ativos) continuam visíveis
  for (const e of execucoes) if (!vistos.has(e.contratoId)) linhaDe(e.contrato, null);

  const cartao = (f: (l: LinhaFaturamentoContrato) => boolean): Cartao => {
    const ls = linhas.filter(f);
    return { q: ls.length, v: Math.round(ls.reduce((a, l) => a + l.valor, 0) * 100) / 100 };
  };
  const resumo: ResumoFaturamentoContratos = {
    contratos: cartao(() => true),
    concluidas: cartao((l) => l.execucao?.situacao === "CONCLUIDA"),
    andamento: cartao((l) => !!l.execucao && ["PENDENTE", "AGUARDANDO"].includes(l.execucao.situacao)),
    atencao: cartao((l) => !!l.execucao && ["FALHA", "PENDENCIA"].includes(l.execucao.situacao)),
  };
  return { ano, mes, linhas, resumo };
}

/** Sino: execuções que pedem alguém (falhou 3× ou pendência) — de qualquer competência */
export const contarAtencaoFaturamento = (empresaId: string) =>
  prisma.faturamentoContratoExecucao.count({ where: { empresaId, situacao: { in: ["FALHA", "PENDENCIA"] } } });
