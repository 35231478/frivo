import type { TipoDesconto } from "@prisma/client";
import type { OrcamentoItemInput, OrcamentoInput } from "./validations";
import { calcularDataFimContrato } from "./utils";

export interface TotaisOrcamento {
  totalServicos: number;
  totalProdutos: number;
  totalBruto: number;
  desconto: number;
  totalGeral: number;
}

export function calcularTotais(
  servicos: OrcamentoItemInput[],
  produtos: OrcamentoItemInput[],
  descontoValor: number,
  tipoDesconto: TipoDesconto,
): TotaisOrcamento {
  const totalServicos = servicos.reduce(
    (acc, it) => acc + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0),
    0,
  );
  const totalProdutos = produtos.reduce(
    (acc, it) => acc + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0),
    0,
  );
  const totalBruto = totalServicos + totalProdutos;

  const desconto =
    tipoDesconto === "PERCENTUAL"
      ? Math.min(totalBruto * (descontoValor / 100), totalBruto)
      : Math.min(descontoValor, totalBruto);

  const totalGeral = Math.max(0, totalBruto - desconto);

  return {
    totalServicos: round2(totalServicos),
    totalProdutos: round2(totalProdutos),
    totalBruto: round2(totalBruto),
    desconto: round2(desconto),
    totalGeral: round2(totalGeral),
  };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

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
      exigePcAntesNf: false, responsavelTecnicoId: null, artNumero: null,
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
