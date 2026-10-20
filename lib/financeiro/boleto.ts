/**
 * Boleto colado na conta a pagar (E2.1, "DDA manual"): linha digitável OU código de barras, com os
 * dígitos verificadores conferidos. Puro (tela e servidor).
 *
 *   Boleto bancário ........ linha digitável de 47 dígitos (5 campos) · código de barras de 44
 *   Convênio/arrecadação ... (contas de consumo, tributos) começa com 8: linha de 48 dígitos (4 blocos
 *                            de 11 + DV) · código de barras de 44
 *
 * Regras FEBRABAN:
 *   - bancário: DV de cada um dos 3 primeiros campos da linha pelo módulo 10; DV geral (posição 5 do
 *     código de barras) pelo módulo 11 (resultado 0, 10 ou 11 vira 1);
 *   - convênio: o 3º dígito diz o módulo — 6/7 = módulo 10, 8/9 = módulo 11 (resto 0 ou 1 vira 0) —,
 *     usado no DV de cada bloco da linha e no DV geral (posição 4 do código de barras).
 * Do código também saem o banco (bancário), o segmento (convênio), o valor e o vencimento (bancário:
 * fator de vencimento, que recomeçou em 1000 no dia 22/02/2025).
 */

export type TipoBoleto = "bancario" | "convenio";

export interface Boleto {
  tipo: TipoBoleto;
  /** só dígitos: 47 (bancário) ou 48 (convênio) */
  linhaDigitavel: string;
  /** só dígitos: 44 */
  codigoBarras: string;
  /** código do banco (bancário), ex.: "341" */
  banco: string | null;
  /** "Itaú", "Banco 999"… (bancário) ou o segmento do convênio ("Energia elétrica e gás") */
  emissor: string;
  /** valor do título em R$; null quando o código não traz valor (zerado ou "valor de referência") */
  valor: number | null;
  /** vencimento "AAAA-MM-DD" do boleto bancário; null sem fator de vencimento (ou no convênio) */
  vencimento: string | null;
}

export type LeituraBoleto = { ok: true; boleto: Boleto } | { ok: false; erro: string };

const BANCOS: Record<string, string> = {
  "001": "Banco do Brasil", "004": "Banco do Nordeste", "021": "Banestes", "033": "Santander", "037": "Banpará",
  "041": "Banrisul", "047": "Banese", "070": "BRB", "077": "Inter", "084": "Uniprime Norte do Paraná", "085": "Ailos",
  "097": "Credisis", "104": "Caixa", "136": "Unicred", "197": "Stone", "208": "BTG Pactual", "212": "Banco Original",
  "237": "Bradesco", "260": "Nubank", "290": "PagBank", "323": "Mercado Pago", "336": "C6 Bank", "341": "Itaú",
  "380": "PicPay", "389": "Mercantil do Brasil", "403": "Cora", "422": "Safra", "623": "Banco Pan", "655": "Votorantim",
  "707": "Daycoval", "745": "Citibank", "748": "Sicredi", "756": "Sicoob",
};
const SEGMENTOS: Record<string, string> = {
  "1": "Prefeitura", "2": "Saneamento", "3": "Energia elétrica e gás", "4": "Telecomunicações",
  "5": "Órgão governamental", "6": "Convênio (empresa ou órgão)", "7": "Multa de trânsito", "9": "Uso exclusivo do banco",
};
export const nomeBanco = (codigo: string) => BANCOS[codigo] ?? `Banco ${codigo}`;

/** Módulo 10 (pesos 2,1,2,1… da direita; produto de 2 dígitos soma os dígitos). */
export function modulo10(numero: string): number {
  let soma = 0;
  for (let i = 0; i < numero.length; i++) {
    const p = Number(numero[numero.length - 1 - i]) * (i % 2 === 0 ? 2 : 1);
    soma += p > 9 ? p - 9 : p;
  }
  return (10 - (soma % 10)) % 10;
}

/** Resto do módulo 11 (pesos 2 a 9 da direita, recomeçando). */
function resto11(numero: string): number {
  let soma = 0;
  for (let i = 0; i < numero.length; i++) soma += Number(numero[numero.length - 1 - i]) * (2 + (i % 8));
  return soma % 11;
}
/** DV geral do boleto bancário: 11 − resto; 0, 10 e 11 viram 1. */
export function modulo11Banco(numero: string): number {
  const dv = 11 - resto11(numero);
  return dv === 0 || dv >= 10 ? 1 : dv;
}
/** DV do convênio pelo módulo 11: resto 0 ou 1 vira 0; senão 11 − resto. */
export function modulo11Convenio(numero: string): number {
  const r = resto11(numero);
  return r <= 1 ? 0 : 11 - r;
}

const DIA = 86_400_000;
const BASE_ANTIGA = Date.UTC(1997, 9, 7); // fator 0 (até 9999 = 21/02/2025)
const BASE_NOVA = Date.UTC(2025, 1, 22); // fator 1000 depois de 22/02/2025
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Vencimento pelo fator (4 dígitos). O fator recomeçou em 1000 em 22/02/2025: o mesmo número pode ser
 * de antes ou de depois — vale a data mais próxima de `hoje`.
 */
export function vencimentoDoFator(fator: number, hoje: Date = new Date()): string | null {
  if (!fator) return null;
  const antiga = BASE_ANTIGA + fator * DIA;
  if (fator < 1000) return iso(antiga);
  const nova = BASE_NOVA + (fator - 1000) * DIA;
  return Math.abs(nova - hoje.getTime()) < Math.abs(antiga - hoje.getTime()) ? iso(nova) : iso(antiga);
}

const centavos = (s: string) => Number(s) / 100;

function montarBancario(codigoBarras: string, linhaDigitavel: string, hoje: Date): Boleto {
  const banco = codigoBarras.slice(0, 3);
  const valor = centavos(codigoBarras.slice(9, 19));
  return {
    tipo: "bancario", linhaDigitavel, codigoBarras, banco, emissor: nomeBanco(banco),
    valor: valor > 0 ? valor : null, vencimento: vencimentoDoFator(Number(codigoBarras.slice(5, 9)), hoje),
  };
}
function montarConvenio(codigoBarras: string, linhaDigitavel: string): Boleto {
  // 3º dígito: 6 ou 8 = o campo é o valor efetivo; 7 ou 9 = valor de referência (não é R$)
  const efetivo = codigoBarras[2] === "6" || codigoBarras[2] === "8";
  const valor = centavos(codigoBarras.slice(4, 15));
  return {
    tipo: "convenio", linhaDigitavel, codigoBarras, banco: null, emissor: SEGMENTOS[codigoBarras[1]] ?? "Convênio",
    valor: efetivo && valor > 0 ? valor : null, vencimento: null,
  };
}

/** Módulo usado pelo convênio, pelo 3º dígito (identificador de valor); null = inválido. */
function moduloConvenio(id: string): ((n: string) => number) | null {
  if (id === "6" || id === "7") return modulo10;
  if (id === "8" || id === "9") return modulo11Convenio;
  return null;
}

const ERRO_TAMANHO = (n: number) =>
  `Boleto incompleto: a linha digitável tem 47 dígitos (boleto bancário) ou 48 (contas de consumo e tributos), e o código de barras, 44. Veio ${n === 1 ? "1 dígito" : `${n} dígitos`}.`;
const ERRO_DV = (onde: string) => `Dígito verificador não confere ${onde}: confira a digitação (ou cole de novo).`;

/** Lê o que foi colado (com ou sem pontos/espaços). `hoje` só decide o fator de vencimento ambíguo. */
export function lerBoleto(texto: string | null | undefined, hoje: Date = new Date()): LeituraBoleto {
  const d = (texto ?? "").replace(/\D/g, "");
  if (!d) return { ok: false, erro: "Cole a linha digitável ou o código de barras do boleto." };

  if (d.length === 47) {
    // Bancário: campo 1 (9+DV), campo 2 (10+DV), campo 3 (10+DV), campo 4 (DV geral), campo 5 (fator+valor)
    const campos = [d.slice(0, 10), d.slice(10, 21), d.slice(21, 32)];
    for (const [i, c] of campos.entries())
      if (modulo10(c.slice(0, -1)) !== Number(c.slice(-1))) return { ok: false, erro: ERRO_DV(`no campo ${i + 1} da linha digitável`) };
    const codigoBarras = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    if (modulo11Banco(codigoBarras.slice(0, 4) + codigoBarras.slice(5)) !== Number(codigoBarras[4]))
      return { ok: false, erro: ERRO_DV("no dígito geral do boleto (campo 4)") };
    return { ok: true, boleto: montarBancario(codigoBarras, d, hoje) };
  }

  if (d.length === 48) {
    if (d[0] !== "8") return { ok: false, erro: "Linha de 48 dígitos é de conta de consumo/tributo e começa com 8: confira a digitação." };
    const mod = moduloConvenio(d[2]);
    if (!mod) return { ok: false, erro: "Código de convênio inválido (3º dígito deve ser 6, 7, 8 ou 9)." };
    const blocos = [0, 1, 2, 3].map((i) => d.slice(i * 12, i * 12 + 12));
    for (const [i, b] of blocos.entries())
      if (mod(b.slice(0, 11)) !== Number(b[11])) return { ok: false, erro: ERRO_DV(`no bloco ${i + 1} da linha digitável`) };
    const codigoBarras = blocos.map((b) => b.slice(0, 11)).join("");
    if (mod(codigoBarras.slice(0, 3) + codigoBarras.slice(4)) !== Number(codigoBarras[3]))
      return { ok: false, erro: ERRO_DV("no dígito geral do código") };
    return { ok: true, boleto: montarConvenio(codigoBarras, d) };
  }

  if (d.length === 44) {
    if (d[0] === "8") {
      const mod = moduloConvenio(d[2]);
      if (!mod) return { ok: false, erro: "Código de convênio inválido (3º dígito deve ser 6, 7, 8 ou 9)." };
      if (mod(d.slice(0, 3) + d.slice(4)) !== Number(d[3])) return { ok: false, erro: ERRO_DV("no código de barras") };
      const linha = [0, 1, 2, 3].map((i) => { const b = d.slice(i * 11, i * 11 + 11); return b + mod(b); }).join("");
      return { ok: true, boleto: montarConvenio(d, linha) };
    }
    if (modulo11Banco(d.slice(0, 4) + d.slice(5)) !== Number(d[4])) return { ok: false, erro: ERRO_DV("no código de barras") };
    const c1 = d.slice(0, 4) + d.slice(19, 24), c2 = d.slice(24, 34), c3 = d.slice(34, 44);
    const linha = c1 + modulo10(c1) + c2 + modulo10(c2) + c3 + modulo10(c3) + d[4] + d.slice(5, 19);
    return { ok: true, boleto: montarBancario(d, linha, hoje) };
  }

  return { ok: false, erro: ERRO_TAMANHO(d.length) };
}

/** Linha digitável com a pontuação de sempre (para ler e conferir no app do banco). */
export function formatarLinhaDigitavel(linha: string): string {
  const d = linha.replace(/\D/g, "");
  if (d.length === 47)
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  if (d.length === 48) return [0, 1, 2, 3].map((i) => `${d.slice(i * 12, i * 12 + 11)}-${d[i * 12 + 11]}`).join(" ");
  return d;
}

/**
 * Valor do boleto ≠ valor da parcela? Aviso (não bloqueia: juros, desconto ou boleto de outra
 * parcela). Sem valor no código: null.
 */
export function avisoValorBoleto(boleto: Pick<Boleto, "valor">, valorParcela: number): string | null {
  if (boleto.valor == null || Math.abs(boleto.valor - valorParcela) < 0.005) return null;
  const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `O boleto é de ${moeda(boleto.valor)} e a parcela, de ${moeda(valorParcela)}: confira se é o boleto certo.`;
}
