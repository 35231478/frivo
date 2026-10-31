/**
 * Contas a Receber — parcelas e baixa parcial (regras puras, sem Prisma). A tela usa estas regras para
 * montar/validar o parcelamento e a baixa; o servidor usa as MESMAS para recusar.
 *
 * Modelo: a conta dividida vira o LANÇAMENTO (status PARCELADO: guarda a origem, o total e as notas e sai
 * das somas e listas); cada parcela é uma conta com `lancamentoId`, com vencimento, valor, status e
 * boleto próprios. A baixa pode ser parcial: `valorRecebido` soma os recebimentos e o saldo em aberto é
 * `valor − valorRecebido`.
 */

export const MIN_PARCELAS = 2;
export const MAX_PARCELAS = 48;

/** Uma parcela do plano: vencimento "AAAA-MM-DD" (dia civil) e valor em reais */
export interface ParcelaPlano { vencimento: string; valor: number }

const cent = (v: number) => Math.round(Number(v) * 100);
const reais = (c: number) => c / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "AAAA-MM-DD" + n meses, no mesmo dia (31/01 + 1 mês = 28 ou 29/02: o último dia do mês) */
export function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.slice(0, 10).split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/**
 * Divide o total em `n` parcelas mensais a partir do primeiro vencimento. Os centavos que não dividem
 * certo vão na 1ª parcela (ex.: R$ 1.000 em 3× = 333,34 + 333,33 + 333,33) — a soma bate sempre.
 */
export function dividirEmParcelas(total: number, n: number, primeiroVencimento: string): ParcelaPlano[] {
  const qtd = Math.max(1, Math.floor(n));
  const totalC = cent(total);
  const base = Math.floor(totalC / qtd);
  const sobra = totalC - base * qtd;
  return Array.from({ length: qtd }, (_, i) => ({
    vencimento: somarMeses(primeiroVencimento, i),
    valor: reais(base + (i === 0 ? sobra : 0)),
  }));
}

/** Soma das parcelas (em reais, sem erro de ponto flutuante) */
export const somaParcelas = (ps: { valor: number }[]) => reais(ps.reduce((s, p) => s + cent(p.valor), 0));

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (v: string) => DIA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** O plano não vale: quantidade fora de 2–48, valor ≤ 0, data inválida ou soma diferente do total */
export function motivoPlanoInvalido(total: number, parcelas: ParcelaPlano[]): string | null {
  if (parcelas.length < MIN_PARCELAS) return `Divida em pelo menos ${MIN_PARCELAS} parcelas.`;
  if (parcelas.length > MAX_PARCELAS) return `No máximo ${MAX_PARCELAS} parcelas.`;
  for (const [i, p] of parcelas.entries()) {
    if (!p.vencimento || !diaValido(p.vencimento)) return `Informe o vencimento da parcela ${i + 1}.`;
    if (!(cent(p.valor) > 0)) return `A parcela ${i + 1} precisa ter valor maior que zero.`;
  }
  const soma = somaParcelas(parcelas);
  if (cent(soma) !== cent(total)) return `A soma das parcelas (${brl(soma)}) tem que ser igual ao valor da conta (${brl(total)}).`;
  return null;
}

export interface ContaParcelavel {
  status: string;
  excluidaEm?: Date | string | null;
  lancamentoId?: string | null;
  valorRecebido?: unknown;
  boletoStatus?: string | null;
  medicaoId?: string | null;
}

/**
 * Parcelar: só a cobrança em aberto, inteira (sem recebimento nem boleto emitido). Previsão de contrato
 * ou de orçamento ainda não é cobrança (fature antes); a fatura recém-criada (prevista até a nota) pode.
 */
export function motivoNaoParcelar(c: ContaParcelavel): string | null {
  if (c.excluidaEm) return "Esta conta foi excluída.";
  if (c.status === "PARCELADO") return "Esta conta já está parcelada.";
  if (c.lancamentoId) return "Esta já é uma parcela.";
  if (c.status === "RECEBIDO") return "Conta recebida não se parcela.";
  if (c.status === "CANCELADO") return "Conta cancelada não se parcela.";
  if (c.status === "PERDA") return "Conta em perda não se parcela.";
  if (Number(c.valorRecebido ?? 0) > 0) return "Já tem recebimento: não dá mais para parcelar.";
  if (c.boletoStatus === "EMITIDO") return "Cancele o boleto antes de parcelar (cada parcela terá o seu).";
  if (c.status === "PREVISTO" && !c.medicaoId) return "Ainda é previsão: fature antes de parcelar.";
  return null;
}

/* ───────── Baixa parcial: recebido × em aberto ───────── */

export interface ContaSaldo { valor: unknown; valorRecebido?: unknown; status: string }

/**
 * Quanto já entrou. Conta RECEBIDA antiga (de antes dos recebimentos, com valorRecebido 0) entrou inteira.
 */
export function recebidoDaConta(c: ContaSaldo): number {
  const rec = Number(c.valorRecebido ?? 0);
  if (c.status === "RECEBIDO" && rec <= 0) return Number(c.valor);
  return rec;
}

/** O que falta receber (recebida, cancelada, em perda ou parcelada = 0: a parcelada está nas parcelas) */
export function saldoDaConta(c: ContaSaldo): number {
  if (c.status === "RECEBIDO" || c.status === "CANCELADO" || c.status === "PARCELADO" || c.status === "PERDA") return 0;
  return reais(Math.max(0, cent(Number(c.valor)) - cent(Number(c.valorRecebido ?? 0))));
}

/** Tem baixa parcial (entrou uma parte e ainda falta) */
export const recebidaEmParte = (c: ContaSaldo) => saldoDaConta(c) > 0 && Number(c.valorRecebido ?? 0) > 0;

/** O recebimento informado não vale: zero/negativo ou mais que o saldo em aberto */
export function motivoValorRecebimento(c: ContaSaldo, valor: number): string | null {
  if (!(cent(valor) > 0)) return "Informe um valor maior que zero.";
  const saldo = saldoDaConta(c);
  if (cent(valor) > cent(saldo)) return `O valor passa do que falta receber (${brl(saldo)}).`;
  return null;
}

/**
 * Com boleto emitido o banco cobra o valor cheio: receber só uma parte por fora deixaria o cliente pagar
 * de novo. A baixa total (o cliente pagou por fora, de uma vez) continua livre.
 */
export function motivoParcialComBoleto(c: ContaSaldo & { boletoStatus?: string | null }, valor: number): string | null {
  if (c.boletoStatus !== "EMITIDO") return null;
  return cent(valor) < cent(saldoDaConta(c)) ? "Boleto emitido: cancele o boleto para receber só uma parte." : null;
}

/** Recebimento que zera o saldo (quita a conta) */
export const quitaConta = (c: ContaSaldo, valor: number) => cent(valor) >= cent(saldoDaConta(c));

/** "Parcela 2/3" */
export const rotuloParcela = (c: { parcelaNumero?: number | null; parcelaTotal?: number | null }) =>
  c.parcelaNumero && c.parcelaTotal ? `Parcela ${c.parcelaNumero}/${c.parcelaTotal}` : null;

/** Número e descrição da parcela a partir do lançamento: "CR-2026-0042/2" e "… — parcela 2/3" */
export const numeroParcela = (numero: string, i: number) => `${numero}/${i}`;
export const descricaoParcela = (descricao: string, i: number, n: number) => `${descricao} — parcela ${i}/${n}`.slice(0, 500);

/**
 * Reajuste do total (ex.: retenções da fatura mudaram) nas parcelas, mantendo a proporção de cada uma;
 * os centavos que sobram vão na 1ª. Devolve os valores novos na mesma ordem.
 */
export function reajustarValores(valores: number[], novoTotal: number): number[] {
  const antes = valores.map(cent);
  const totalAntes = antes.reduce((s, v) => s + v, 0);
  const novoC = cent(novoTotal);
  if (totalAntes <= 0) return dividirEmParcelas(novoTotal, valores.length, "2000-01-01").map((p) => p.valor);
  const novos = antes.map((v) => Math.floor((v * novoC) / totalAntes));
  novos[0] += novoC - novos.reduce((s, v) => s + v, 0);
  return novos.map(reais);
}
