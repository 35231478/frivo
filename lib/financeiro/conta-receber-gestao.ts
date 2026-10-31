/**
 * Contas a Receber — gestão (regras puras, sem Prisma): de onde a conta veio, o que pode ser feito
 * com ela em cada situação (receber, cancelar, excluir, recibo) e quais campos ficam travados.
 * A tela usa estas regras para habilitar o menu ⋮ e o servidor usa as MESMAS para recusar.
 */
import { rotuloMedicao } from "@/lib/faturamento/fatura";

export type OrigemConta = "MANUAL" | "MEDICAO" | "ORCAMENTO" | "CONTRATO";

export interface ContaGestao {
  status: string;
  medicaoId?: string | null;
  orcamentoId?: string | null;
  contratoId?: string | null;
  boletoStatus?: string | null;
  excluidaEm?: Date | string | null;
  /** Notas fiscais ligadas à conta (só o status importa; na parcela, as do lançamento) */
  notas?: { status: string }[];
  /** Baixa parcial: quanto já entrou */
  valorRecebido?: unknown;
  /** Parcela: o lançamento (conta PARCELADO) de onde ela saiu */
  lancamentoId?: string | null;
}

/** Medição vem antes de contrato: a mensalidade aprovada é uma medição do contrato. */
export function origemDaConta(c: Pick<ContaGestao, "medicaoId" | "orcamentoId" | "contratoId">): OrigemConta {
  if (c.medicaoId) return "MEDICAO";
  if (c.orcamentoId) return "ORCAMENTO";
  if (c.contratoId) return "CONTRATO";
  return "MANUAL";
}

export const ROTULO_ORIGEM: Record<OrigemConta, string> = {
  MANUAL: "Lançamento manual", MEDICAO: "Medição", ORCAMENTO: "Orçamento", CONTRATO: "Contrato",
};

/** Nota fiscal que conta como "documento fiscal": em emissão ou autorizada (rejeitada/cancelada não). */
const STATUS_NOTA_VALIDA = new Set(["ENVIANDO", "PROCESSANDO", "CONCLUIDO"]);
export const temDocumentoFiscal = (notas: { status: string }[] = []) => notas.some((n) => STATUS_NOTA_VALIDA.has(n.status));

const quitada = (s: string) => s === "RECEBIDO" || s === "CANCELADO";
const temRecebimento = (c: ContaGestao) => Number(c.valorRecebido ?? 0) > 0;
const MSG_PARCELADA = "Conta parcelada: as ações ficam em cada parcela.";
const MSG_PERDA = "Conta em perda: reverta a perda antes.";
const boletoAtivo = (b?: string | null) => b === "EMITIDO";

export const MSG_EXCLUIR_NOTA = "Conta com nota fiscal: use Cancelar.";

/**
 * Excluir (lógico) só a conta MANUAL sem documento fiscal. Conta de medição, orçamento ou contrato
 * tem lastro (valor legal/comercial): fica e pode ser cancelada.
 */
export function motivoNaoExcluir(c: ContaGestao): string | null {
  if (c.excluidaEm) return "Esta conta já foi excluída.";
  if (c.status === "PARCELADO") return MSG_PARCELADA;
  if (c.status === "PERDA") return MSG_PERDA;
  if (c.lancamentoId) return "Parcela: use Cancelar.";
  if (temRecebimento(c)) return "Já tem recebimento: não pode ser excluída.";
  if (temDocumentoFiscal(c.notas)) return MSG_EXCLUIR_NOTA;
  const origem = origemDaConta(c);
  if (origem === "MEDICAO") return "Conta de medição: use Cancelar.";
  if (origem === "ORCAMENTO") return "Conta de orçamento aprovado: use Cancelar.";
  if (origem === "CONTRATO") return "Conta de contrato: use Cancelar.";
  if (boletoAtivo(c.boletoStatus)) return "Cancele o boleto antes de excluir.";
  return null;
}

export function motivoNaoCancelar(c: ContaGestao): string | null {
  if (c.excluidaEm) return "Esta conta foi excluída.";
  if (c.status === "CANCELADO") return "Esta conta já está cancelada.";
  if (c.status === "RECEBIDO") return "Conta recebida não pode ser cancelada.";
  if (c.status === "PARCELADO") return MSG_PARCELADA;
  if (c.status === "PERDA") return MSG_PERDA;
  if (temRecebimento(c)) return "Já tem recebimento parcial: não pode ser cancelada.";
  if (boletoAtivo(c.boletoStatus)) return "Cancele o boleto antes: o cliente ainda consegue pagá-lo.";
  return null;
}

export function motivoNaoReceber(c: ContaGestao): string | null {
  if (c.excluidaEm) return "Esta conta foi excluída.";
  if (c.status === "RECEBIDO") return "Esta conta já foi recebida.";
  if (c.status === "CANCELADO") return "Conta cancelada não recebe baixa.";
  if (c.status === "PARCELADO") return "Conta parcelada: informe o recebimento em cada parcela.";
  if (c.status === "PERDA") return "Conta em perda: use \"Reverter perda\" para registrar o que o cliente pagou.";
  return null;
}

export const motivoNaoRecibo = (c: ContaGestao): string | null =>
  c.status === "RECEBIDO" ? null : "O recibo sai depois de informar o recebimento.";

/**
 * Campos que não mudam mais (null = livre):
 *  - recebida/cancelada: valor e vencimento ficam como estão;
 *  - boleto emitido: o banco já tem valor e vencimento (cancele o boleto para mudar);
 *  - nota fiscal emitida: o valor é o da nota.
 */
export function travasDaConta(c: ContaGestao): { valor: string | null; vencimento: string | null } {
  if (c.status === "PARCELADO") return { valor: MSG_PARCELADA, vencimento: MSG_PARCELADA };
  if (c.status === "PERDA") return { valor: MSG_PERDA, vencimento: MSG_PERDA };
  if (quitada(c.status)) {
    const m = c.status === "RECEBIDO" ? "Conta recebida." : "Conta cancelada.";
    return { valor: m, vencimento: m };
  }
  if (boletoAtivo(c.boletoStatus)) {
    const m = "Boleto emitido: cancele o boleto para mudar.";
    return { valor: m, vencimento: m };
  }
  if (temRecebimento(c)) return { valor: "Já tem recebimento: o valor não muda.", vencimento: null };
  if (c.lancamentoId) return { valor: "Parcela: o valor vem do parcelamento.", vencimento: null };
  return { valor: temDocumentoFiscal(c.notas) ? "Valor da nota fiscal emitida." : null, vencimento: null };
}

/** Cliente só muda na conta manual sem boleto nem nota (nas outras, ele vem da origem). */
export function motivoNaoTrocarCliente(c: ContaGestao): string | null {
  if (c.lancamentoId || c.status === "PARCELADO") return "O cliente vem do lançamento parcelado.";
  if (origemDaConta(c) !== "MANUAL") return "O cliente vem da origem da conta.";
  if (boletoAtivo(c.boletoStatus)) return "Boleto emitido para este cliente: cancele o boleto para trocar.";
  if (temDocumentoFiscal(c.notas)) return "Nota fiscal emitida para este cliente.";
  if (c.status === "PERDA") return MSG_PERDA;
  if (quitada(c.status)) return c.status === "RECEBIDO" ? "Conta recebida." : "Conta cancelada.";
  return null;
}

export interface AlteracaoConta {
  cliente?: string | null; descricao?: string; valor?: number; dataVencimento?: string | null; formaPagamento?: string | null;
  categoria?: string | null; centroCusto?: string | null; contaBancaria?: string | null; observacao?: string | null;
}

const ROTULO_CAMPO: Record<keyof AlteracaoConta, string> = {
  cliente: "Cliente", descricao: "Descrição", valor: "Valor", dataVencimento: "Vencimento", formaPagamento: "Forma de pagamento",
  categoria: "Categoria", centroCusto: "Centro de custo", contaBancaria: "Conta bancária", observacao: "Observações",
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (v: string) => v.slice(0, 10).split("-").reverse().join("/");
const mostrar = (k: keyof AlteracaoConta, v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : k === "valor" ? brl(Number(v)) : k === "dataVencimento" ? dia(String(v)) : String(v);

/** Texto do evento "Editada": só o que mudou, no formato "Campo: antes → depois" (observação: só "alterada"). */
export function descreverAlteracoes(antes: AlteracaoConta, depois: AlteracaoConta): string {
  const partes: string[] = [];
  for (const k of Object.keys(ROTULO_CAMPO) as (keyof AlteracaoConta)[]) {
    if (!(k in depois)) continue;
    const a = antes[k] ?? null, d = depois[k] ?? null;
    const igual = k === "valor" ? Number(a) === Number(d) : k === "dataVencimento" ? String(a ?? "").slice(0, 10) === String(d ?? "").slice(0, 10) : (a ?? "") === (d ?? "");
    if (igual) continue;
    partes.push(k === "observacao" || k === "descricao" ? `${ROTULO_CAMPO[k]} alterada` : `${ROTULO_CAMPO[k]}: ${mostrar(k, a)} → ${mostrar(k, d)}`);
  }
  return partes.join("; ");
}

export const ROTULO_EVENTO_CR: Record<string, string> = {
  CRIADA: "Criada", EDITADA: "Editada", RECEBIDA: "Recebimento informado", CANCELADA: "Cancelada", EXCLUIDA: "Excluída",
  BOLETO_EMITIDO: "Boleto emitido", BOLETO_CANCELADO: "Boleto cancelado", COBRANCA_ENVIADA: "Cobrança enviada",
  FATURADA: "Faturada", REABERTA: "Voltou a ser previsão", RETENCOES: "Retenções",
  PARCELADA: "Parcelada", RECEBIMENTO_PARCIAL: "Recebimento parcial", REAJUSTADA: "Parcelas reajustadas",
  PERDA: "Marcada como perda", PERDA_REVERTIDA: "Perda revertida", ESTORNADA: "Recebimento estornado",
};

/** Valor por extenso (reais e centavos) para o recibo. Até 999.999.999,99. */
export function valorPorExtenso(valor: number): string {
  const U = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
    "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  const ate999 = (n: number): string => {
    if (n === 100) return "cem";
    const c = Math.floor(n / 100), r = n % 100;
    const dez = r < 20 ? U[r] : [D[Math.floor(r / 10)], U[r % 10]].filter(Boolean).join(" e ");
    return [C[c], dez].filter(Boolean).join(" e ");
  };
  const total = Math.round(Math.abs(valor) * 100);
  const inteiro = Math.floor(total / 100), centavos = total % 100;
  const mi = Math.floor(inteiro / 1_000_000), mil = Math.floor((inteiro % 1_000_000) / 1000), resto = inteiro % 1000;
  const grupos: { texto: string; valor: number }[] = [];
  if (mi) grupos.push({ texto: `${ate999(mi)} ${mi === 1 ? "milhão" : "milhões"}`, valor: mi });
  if (mil) grupos.push({ texto: mil === 1 ? "mil" : `${ate999(mil)} mil`, valor: mil });
  if (resto) grupos.push({ texto: ate999(resto), valor: resto });
  // "e" antes do último grupo quando ele é < 100 ou centena redonda (mil e cem; dois milhões e quinhentos mil)
  const ultimo = grupos[grupos.length - 1];
  let reais = grupos.length > 1 && (ultimo.valor < 100 || ultimo.valor % 100 === 0)
    ? `${grupos.slice(0, -1).map((g) => g.texto).join(" ")} e ${ultimo.texto}`
    : grupos.map((g) => g.texto).join(" ");
  if (inteiro) reais += `${mi && !mil && !resto ? " de" : ""} ${inteiro === 1 ? "real" : "reais"}`;
  const cents = centavos ? `${ate999(centavos)} ${centavos === 1 ? "centavo" : "centavos"}` : "";
  if (!inteiro && !centavos) return "zero real";
  return [reais, cents].filter(Boolean).join(" e ");
}

/** Links das origens (mesmas rotas das telas de cada uma). */
export const hrefOrcamento = (id: string) => `/orcamentos/${id}`;
export const hrefMedicao = (id: string) => `/financeiro/medicoes/${id}`;
export const hrefContrato = (id: string) => `/contratos/${id}`;
export const hrefOs = (id: string) => `/ordens/${id}`;
/** A fatura avulsa ("Faturar") abre a mesma tela da medição, com o breadcrumb "Faturas" */
export const hrefFatura = (id: string) => `/financeiro/faturas/${id}`;
/** Abre a conta direto na gaveta de detalhes da lista de Contas a Receber. */
export const hrefContaReceber = (id: string) => `/financeiro/contas-receber?conta=${id}`;

/** Origem em uma linha, com link: "Orçamento ORC-…", "Medição MED-…", "Contrato CT-…" (manual = null). */
export function origemComLink(c: {
  medicaoId?: string | null; orcamentoId?: string | null; contratoId?: string | null;
  medicaoNumero?: string | null; orcamentoCodigo?: string | null; contratoNumero?: string | null;
  /** Fatura avulsa ("Faturar"): aparece como "Fatura 2026-0012" */
  medicaoAvulsa?: boolean | null;
}): { rotulo: string; href: string } | null {
  if (c.medicaoId) {
    const rotulo = c.medicaoNumero ? rotuloMedicao({ numero: c.medicaoNumero, avulsa: c.medicaoAvulsa }) : c.medicaoAvulsa ? "Fatura" : "Medição";
    return { rotulo, href: c.medicaoAvulsa ? hrefFatura(c.medicaoId) : hrefMedicao(c.medicaoId) };
  }
  if (c.orcamentoId) return { rotulo: `Orçamento ${c.orcamentoCodigo ?? ""}`.trim(), href: hrefOrcamento(c.orcamentoId) };
  if (c.contratoId) return { rotulo: `Contrato ${c.contratoNumero ?? ""}`.trim(), href: hrefContrato(c.contratoId) };
  return null;
}
