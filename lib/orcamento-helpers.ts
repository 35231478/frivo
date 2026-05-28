import type { TipoDesconto } from "@prisma/client";
import type { OrcamentoItemInput } from "./validations";

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
