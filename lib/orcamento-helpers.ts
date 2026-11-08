import type { OrcamentoInput } from "./validations";
import { calcularDataFimContrato } from "./utils";
import { calcularOrcamento, descontoGeralPorGrupo, totalDoItem, type TotaisOrcamento } from "./orcamentos/calculo";
import { prepararServicosComMateriais } from "./orcamentos/materiais";
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
  // E3.3: serviço com materiais vale base + ajuste dos inclusos (ou o manual); as peças viram linhas de produto
  const prep = prepararServicosComMateriais(data.servicos);
  const servicosEfetivos = prep.linhas.map((l) => ({ quantidade: l.linha.quantidade, valorUnitario: l.valor.valorUnitario, valorTotal: l.valor.valorTotal }));
  const produtosDoUsuario = data.produtos.map((p) => ({ ...p, materiais: undefined }));
  const todosProdutos = [...produtosDoUsuario, ...prep.pecas.map((p) => ({ quantidade: p.quantidade, valorUnitario: p.valorUnitario, valorTotal: p.valorTotal }))];
  const subtotal = (itens: { quantidade: unknown; valorUnitario: unknown; valorTotal?: unknown }[]) => itens.reduce((s, it) => s + totalDoItem(it), 0);
  // Formato antigo (só o desconto geral): reparte nos grupos com a mesma soma
  const porGrupo = data.descontoServicos === undefined && data.descontoProdutos === undefined && data.desconto > 0
    ? { ...descontoGeralPorGrupo(subtotal(servicosEfetivos), subtotal(todosProdutos), data.desconto, data.tipoDesconto), tipoDescontoServicos: "VALOR" as const, tipoDescontoProdutos: "VALOR" as const }
    : { descontoServicos: data.descontoServicos ?? 0, tipoDescontoServicos: data.tipoDescontoServicos, descontoProdutos: data.descontoProdutos ?? 0, tipoDescontoProdutos: data.tipoDescontoProdutos };

  const totais: TotaisOrcamento = calcularOrcamento({ servicos: servicosEfetivos, produtos: todosProdutos, issAliquota, ...porGrupo });
  const item = (it: OrcamentoInput["servicos"][number], idx: number) => ({
    descricao: it.descricao,
    quantidade: it.quantidade,
    valorUnitario: it.valorUnitario,
    valorTotal: totalDoItem(it),
    observacao: it.observacao?.trim() || null,
    ordem: idx,
  });
  const nProdutos = produtosDoUsuario.length;
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
    servicos: prep.linhas.map(({ linha: s, valor: v, materiais }, idx) => ({
      servicoId: s.catalogoId || null, ...item(s, idx),
      // O que vale: base + ajuste (ou o manual); o unitário efetivo = total ÷ qtd (o que a OS, a fatura e a nota leem)
      valorUnitario: v.valorUnitario, valorTotal: v.valorTotal, valorBase: v.valorBase, ajusteMateriais: v.ajuste, valorManual: v.valorManual,
      materiais: materiais.map((m) => ({
        id: m.id ?? undefined, produtoId: m.produtoId ?? null, descricao: m.descricao, unidade: m.unidade || "un", comportamento: m.comportamento,
        quantidade: m.quantidade, quantidadePadrao: m.quantidadePadrao, valorVendaUnit: m.valorVendaUnit, custoUnit: m.custoUnit ?? null, origem: m.origem, kitNome: m.kitNome ?? null, ordem: m.ordem,
      })),
    })),
    produtos: produtosDoUsuario.map((p, idx) => ({ produtoId: p.catalogoId || null, ...item(p, idx) })),
    // Peças (venda à parte) das linhas de serviço: linhas de produto derivadas, depois dos produtos do usuário
    pecas: prep.pecas.map((p, i) => ({
      produtoId: p.material.produtoId ?? null, descricao: p.descricao, quantidade: p.quantidade, valorUnitario: p.valorUnitario, valorTotal: p.valorTotal,
      observacao: null, ordem: nProdutos + i, idxServico: p.idxServico, idxMaterial: prep.linhas[p.idxServico].materiais.indexOf(p.material as never),
    })),
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
    `Prezados,\n\nSegue o orçamento ${codigo} para avaliação:\n\n${publicUrl}\n\n` +
    `A aprovação pode ser feita digitalmente pelo link acima.\n\n` +
    `Atenciosamente,\n${empresaNome}`;
  return `mailto:${encodeURIComponent(emailDestino)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
