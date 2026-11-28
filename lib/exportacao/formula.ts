/**
 * CSV CONTRA FÓRMULA (CSV injection, padrão OWASP) — a ida e a volta num lugar só. Puro: telas, servidor e testes.
 *
 *  - IDA (a exportação, lib/exportacao/arquivos › celulaCsv): uma célula de TEXTO que começa com = + - @, TAB ou CR
 *    sai com um apóstrofo na frente (`'=HYPERLINK(...)`). O Excel/LibreOffice então mostra o texto, em vez de
 *    executar uma fórmula que alguém digitou num cadastro (ex.: o nome de um cliente).
 *  - NÚMEROS não levam o apóstrofo: o número em si (-5) e o número já formatado pela exportação ("-5", "-1250,50")
 *    continuam números na planilha. Só o texto que começa com um desses caracteres é protegido ("-5 graus").
 *  - VOLTA (a importação da Implantação, lib/importacao/motor › analisar): a célula que começa com o apóstrofo
 *    SEGUIDO de um desses caracteres perde o apóstrofo — exportar e importar de volta devolve o valor original.
 *    Um apóstrofo seguido de qualquer outra coisa ("'Ponto de vista'") fica como está.
 */

const PERIGOSO = /^[=+\-@\t\r]/;
const PROTEGIDO = /^'[=+\-@\t\r]/;
/** Número puro, como a exportação escreve (sem milhar, vírgula ou ponto decimal): "-5", "+3", "-1250,50" */
const NUMERO = /^[+-]?\d+([.,]\d+)?$/;

/** A célula, como vai para o CSV: texto perigoso ganha o apóstrofo; número (e número formatado) não. */
export function protegerFormula(v: unknown): unknown {
  if (typeof v !== "string") return v;
  return PERIGOSO.test(v) && !NUMERO.test(v) ? `'${v}` : v;
}

/** A célula lida da planilha: tira o apóstrofo que a exportação pôs (só antes de = + - @ TAB CR). */
export function desprotegerFormula<T>(v: T): T {
  return (typeof v === "string" && PROTEGIDO.test(v) ? v.slice(1) : v) as T;
}
