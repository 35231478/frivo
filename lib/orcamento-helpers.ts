import type { OrcamentoInput } from "./validations";
import { calcularDataFimContrato } from "./utils";
import { calcularOrcamento, descontoGeralPorGrupo, totalDoItem, type TotaisOrcamento } from "./orcamentos/calculo";
import { linhasNaoIncluso, normasValidas } from "./orcamentos/proposta";

/**
 * Os valores do orçamento a gravar, pelo cálculo único (lib/orcamentos/calculo.ts):
 *  - cada item guarda o total que vale (o digitado, se coerente com o unitário);
 *  - `totalServicos`/`totalProdutos` = subtotais BRUTOS dos grupos (como sempre foram);
 *  - `desconto` = soma dos descontos dos grupos em R$ (tipoDesconto VALOR) — leitores antigos continuam certos;
 *  - `totalGeral` = serviços − desconto + ISS + produtos − desconto.
 * `issAliquota` é a alíquota congelada neste orçamento (a da empresa na criação).
 */
export function montarValoresOrcamento(data: OrcamentoInput, issAliquota: number) {
  const subtotal = (itens: OrcamentoInput["servicos"]) => itens.reduce((s, it) => s + totalDoItem(it), 0);
  // Formato antigo (só o desconto geral): reparte nos grupos com a mesma soma
  const porGrupo = data.descontoServicos === undefined && data.descontoProdutos === undefined && data.desconto > 0
    ? { ...descontoGeralPorGrupo(subtotal(data.servicos), subtotal(data.produtos), data.desconto, data.tipoDesconto), tipoDescontoServicos: "VALOR" as const, tipoDescontoProdutos: "VALOR" as const }
    : { descontoServicos: data.descontoServicos ?? 0, tipoDescontoServicos: data.tipoDescontoServicos, descontoProdutos: data.descontoProdutos ?? 0, tipoDescontoProdutos: data.tipoDescontoProdutos };

  const totais: TotaisOrcamento = calcularOrcamento({ servicos: data.servicos, produtos: data.produtos, issAliquota, ...porGrupo });
  const item = (it: OrcamentoInput["servicos"][number], idx: number) => ({
    descricao: it.descricao,
    quantidade: it.quantidade,
    valorUnitario: it.valorUnitario,
    valorTotal: totalDoItem(it),
    observacao: it.observacao?.trim() || null,
    ordem: idx,
  });
  return {
    totais,
    campos: {
      desconto: totais.descontoTotal,
      tipoDesconto: "VALOR" as const,
      descontoServicos: porGrupo.descontoServicos,
      tipoDescontoServicos: porGrupo.tipoDescontoServicos,
      descontoProdutos: porGrupo.descontoProdutos,
      tipoDescontoProdutos: porGrupo.tipoDescontoProdutos,
      issAliquota: totais.issAliquota,
      valorIss: totais.valorIss,
      totalServicos: totais.subtotalServicos,
      totalProdutos: totais.subtotalProdutos,
      totalGeral: totais.totalGeral,
    },
    servicos: data.servicos.map((s, idx) => ({ servicoId: s.catalogoId || null, ...item(s, idx) })),
    produtos: data.produtos.map((p, idx) => ({ produtoId: p.catalogoId || null, ...item(p, idx) })),
  };
}

/** O que vale quando o campo não veio no corpo: no novo, os padrões de Configurações; na edição, o gravado. */
export interface BaseCondicoes {
  garantiaServico?: string | null;
  garantiaPecas?: string | null;
  naoIncluso?: string | null;
  normas?: readonly string[] | null;
}

const textoOuNulo = (v: string | null | undefined) => v?.trim() || null;

/** Condições que saem no documento do cliente (prazo, pagamento, garantias, não incluso, normas) */
export const camposCondicoes = (data: OrcamentoInput, base: BaseCondicoes = {}) => ({
  prazoExecucao: textoOuNulo(data.prazoExecucao),
  formaPagamento: textoOuNulo(data.formaPagamento),
  // undefined = não veio (usa a base); null/"" = apagado de propósito
  garantiaServico: textoOuNulo(data.garantiaServico === undefined ? base.garantiaServico : data.garantiaServico),
  garantiaPecas: textoOuNulo(data.garantiaPecas === undefined ? base.garantiaPecas : data.garantiaPecas),
  naoIncluso: linhasNaoIncluso(data.naoIncluso === undefined ? base.naoIncluso : data.naoIncluso).join("\n") || null,
  normas: normasValidas(data.normas === undefined ? base.normas : data.normas),
});

/**
 * Monta os campos da proposta de contrato a partir do payload validado.
 * Para tipo COMUM, zera/anula todos os campos específicos de proposta.
 */
export function montarCamposProposta(data: OrcamentoInput) {
  if (data.tipo !== "PROPOSTA_CONTRATO") {
    return {
      tipo: "COMUM" as const,
      valorMensal: null, frequenciaContrato: null, diaExecucao: null,
      dataInicioContrato: null, vigenciaMeses: null, dataFimContrato: null,
      condicaoPagamento: null, diaFaturamento: null, perfilFaturamento: null,
      exigePcAntesNf: false,
      // Responsável técnico e ART valem também no orçamento comum (bloco RT do documento)
      responsavelTecnicoId: data.responsavelTecnicoId || null, artNumero: data.artNumero?.trim() || null,
      termoReferencia: null, visitasPorPeriodo: null, equipamentosCobertos: [],
      prazoEmergencial: null, prazoNormal: null, horarioAtendimento: null,
    };
  }
  const inicio = data.dataInicioContrato ? new Date(data.dataInicioContrato) : null;
  const dataFim = calcularDataFimContrato(inicio, data.vigenciaMeses ?? null);
  return {
    tipo: "PROPOSTA_CONTRATO" as const,
    valorMensal: data.valorMensal ?? null,
    frequenciaContrato: data.frequenciaContrato ?? null,
    diaExecucao: data.diaExecucao ?? null,
    dataInicioContrato: inicio,
    vigenciaMeses: data.vigenciaMeses ?? null,
    dataFimContrato: dataFim,
    condicaoPagamento: data.condicaoPagamento?.trim() || null,
    diaFaturamento: data.diaFaturamento ?? null,
    perfilFaturamento: data.perfilFaturamento ?? null,
    exigePcAntesNf: data.exigePcAntesNf ?? false,
    responsavelTecnicoId: data.responsavelTecnicoId || null,
    artNumero: data.artNumero?.trim() || null,
    termoReferencia: data.termoReferencia ?? null,
    visitasPorPeriodo: data.visitasPorPeriodo ?? null,
    equipamentosCobertos: data.equipamentosCobertos ?? [],
    prazoEmergencial: data.prazoEmergencial ?? null,
    prazoNormal: data.prazoNormal ?? null,
    horarioAtendimento: data.horarioAtendimento?.trim() || null,
  };
}

export function buildPublicUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/orcamento/${token}`;
}

export function buildMailtoLink(
  emailDestino: string,
  empresaNome: string,
  codigo: string,
  publicUrl: string,
): string {
  const assunto = `Orçamento ${codigo} — ${empresaNome}`;
  const corpo =
    `Olá,\n\nSegue o orçamento ${codigo} para sua avaliação:\n\n${publicUrl}\n\n` +
    `Você poderá aprová-lo digitalmente diretamente pelo link acima.\n\n` +
    `Atenciosamente,\n${empresaNome}`;
  return `mailto:${encodeURIComponent(emailDestino)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
