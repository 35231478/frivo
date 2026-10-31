/**
 * Retenções que uma medição NOVA herda dos serviços dos itens (cadastro: "ISS retido" / "Reter …" +
 * alíquota) — a MESMA regra para o "Faturar" (fatura avulsa) e para a medição mensal do contrato.
 * Uma retenção só vale quando todos os serviços com valor a marcam (retencoesDosServicos); item sem
 * serviço não retém, então ela fica de fora (ajuste no "Editar"). Base = o valor da nota
 * (baseRetencoes). Retenção que passaria da base não entra.
 */
import { prisma } from "@/lib/prisma";
import { pendenciasServicoNfse } from "@/lib/nfse/servico";
import { baseRetencoes, calcularRetencoes, camposDaMedicao, motivoRetencaoInvalida, retencoesDosServicos, SELECT_RETENCOES_SERVICO } from "@/lib/financeiro/retencoes";

export interface LinhaComServico { tipo: string; valorTotal: number; servicoId?: string | null }

export async function retencoesHerdadas(empresaId: string, m: { valorTotal: number; valorLiquido: number; linhas: LinhaComServico[] }) {
  const ids = [...new Set(m.linhas.map((l) => l.servicoId).filter((x): x is string => !!x))];
  const [servicos, config] = await Promise.all([
    ids.length ? prisma.servico.findMany({ where: { id: { in: ids }, empresaId }, select: SELECT_RETENCOES_SERVICO }) : [],
    prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } }),
  ]);
  const porId = new Map(servicos.map((s) => [s.id, s]));
  const { retencoes } = retencoesDosServicos(
    m.linhas.map((l) => ({ tipo: l.tipo, valorTotal: l.valorTotal, servico: l.servicoId ? porId.get(l.servicoId) ?? null : null })),
    config?.issAliquota != null ? Number(config.issAliquota) : null,
  );
  const base = baseRetencoes({ valorTotal: m.valorTotal, valorLiquido: m.valorLiquido, itens: m.linhas });
  if (motivoRetencaoInvalida(base, retencoes)) return { campos: camposDaMedicao({}), total: 0 };
  return { campos: camposDaMedicao(retencoes), total: calcularRetencoes(base, retencoes).total };
}

/**
 * Prévia da cobrança mensal do contrato com o serviço padrão escolhido: "Cobrança R$ X − retenções
 * R$ Y = cobrado R$ Z", pela MESMA regra da medição (um item de serviço = a mensalidade), e o que
 * ainda falta no cadastro do serviço para a NFS-e sair (código LC 116, alíquota de ISS).
 * Serviço de outra empresa → null.
 */
export async function previaCobrancaContrato(empresaId: string, servicoId: string, valor: number) {
  const [servico, config] = await Promise.all([
    prisma.servico.findFirst({
      where: { id: servicoId, empresaId },
      select: { ...SELECT_RETENCOES_SERVICO, nome: true, codigo: true, ativo: true, codigoLc116: true, nfseTributacao: true },
    }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } }),
  ]);
  if (!servico) return null;
  const issPadrao = config?.issAliquota != null ? Number(config.issAliquota) : null;
  const bruto = Math.max(0, Number.isFinite(valor) ? valor : 0); // calcularRetencoes trabalha no centavo
  const { retencoes } = retencoesDosServicos([{ tipo: "SERVICO", valorTotal: bruto, servico }], issPadrao);
  const det = calcularRetencoes(bruto, motivoRetencaoInvalida(bruto, retencoes) ? {} : retencoes);
  const aliquotaISS = servico.aliquotaISS != null ? Number(servico.aliquotaISS) : null;
  return {
    servico: { id: servico.id, nome: servico.nome, codigo: servico.codigo, ativo: servico.ativo },
    ...det,
    pendenciasNfse: pendenciasServicoNfse({ nome: servico.nome, codigoLc116: servico.codigoLc116, nfseTributacao: servico.nfseTributacao, aliquotaISS }, issPadrao),
  };
}
