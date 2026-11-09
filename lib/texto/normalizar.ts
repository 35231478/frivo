/**
 * Padronização de digitação (casing) do Frivo — a função compartilhada, uma só.
 *
 * O dado entra em CAPS, minúsculo ou misturado; aqui vira um padrão único. É a fonte da verdade:
 * o servidor normaliza antes de gravar (criar/editar, importação em massa, lead do site) e o
 * cliente ajeita no `onBlur`. A MESMA função roda nos dois lados e na limpeza dos dados antigos,
 * para o resultado ser sempre igual (idempotente).
 *
 * Regras:
 * - nome          → "Nome Próprio": inicial de cada palavra em maiúscula; conectores (de, da, do,
 *                   das, dos, e) em minúscula, menos na 1ª palavra; siglas preservadas por uma lista
 *                   curada e extensível (LTDA→Ltda, ME, EPP, VRF, CNPJ…). Não há "todo token curto em
 *                   CAPS é sigla": isso transformaria nomes curtos (Ana, Ivo) em sigla; quem precisa
 *                   de uma sigla nova a acrescenta em SIGLAS.
 * - email         → minúsculo + trim.
 * - cidade/endereço → "Nome Próprio" (logradouro, bairro).
 * - livre         → só apara espaços; NÃO mexe no casing (observações, descrições).
 * Todo campo apara espaços (começo/fim e duplicados no meio). NÃO use em senha, token, documentos
 * mascarados (CNPJ/CPF/placa) nem em campos fiscais — a origem escolhe quais campos passam por aqui.
 */

export type TipoTexto = "nome" | "email" | "cidade" | "endereco" | "livre";

/** Conectores que ficam em minúsculo no meio de um nome próprio. */
const CONECTORES = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Siglas/termos que ficam em MAIÚSCULO (comparação feita com o token em caixa alta). */
const SIGLAS = new Set([
  "ME", "EPP", "EIRELI", "MEI", "SA", "S/A", "S.A", "S.A.",
  "VRF", "PMOC", "BTU", "BTUS", "CNPJ", "CPF", "RG", "IE", "IM", "CEP", "UF",
  "LED", "AC", "QG", "TI", "RH", "CEO", "CFO",
]);

/** Siglas com forma canônica em caixa mista (ganham de SIGLAS e da heurística). */
const ESPECIAIS = new Map<string, string>([
  ["LTDA", "Ltda"], ["LTDA.", "Ltda."],
]);

/** Apara espaços de uma linha única: tira das pontas e reduz repetidos no meio a um só. */
export function apararLinha(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/**
 * Apara espaços de texto livre: reduz espaços/tabs repetidos, tira espaço em volta das quebras e
 * das pontas, mas PRESERVA as quebras de linha (não junta parágrafos).
 */
export function apararTextoLivre(valor: string): string {
  return valor.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim();
}

/** Deixa a primeira letra de uma palavra em maiúscula e o resto em minúscula (respeita acento). */
function capitalizar(palavra: string): string {
  if (!palavra) return palavra;
  const baixa = palavra.toLocaleLowerCase("pt-BR");
  return baixa.charAt(0).toLocaleUpperCase("pt-BR") + baixa.slice(1);
}

/** Processa um token (palavra) de um nome próprio, ciente da posição. */
function tokenNome(token: string, primeiro: boolean): string {
  if (!token) return token;
  const alto = token.toLocaleUpperCase("pt-BR");

  // Caso canônico (LTDA → Ltda)
  const especial = ESPECIAIS.get(alto);
  if (especial) return especial;

  // Sigla explícita (lista curada) → maiúsculo
  if (SIGLAS.has(alto)) return alto;

  // Conector no meio → minúsculo; na 1ª palavra, capitaliza
  const baixo = token.toLocaleLowerCase("pt-BR");
  if (CONECTORES.has(baixo)) return primeiro ? capitalizar(token) : baixo;

  // Palavra comum: capitaliza por sub-partes separadas por hífen (ex.: "ana-maria" → "Ana-Maria")
  return token.split("-").map(capitalizar).join("-");
}

/** "Nome Próprio" a partir de qualquer caixa. Usado em nomes, cidade e endereço. */
export function padronizarNome(valor: string | null | undefined): string {
  const base = apararLinha(valor ?? "");
  if (!base) return "";
  const tokens = base.split(" ");
  // o "primeiro" (para conector) é o 1º token que tem letra
  let jaViuPalavra = false;
  return tokens
    .map((tk) => {
      const temLetra = /\p{L}/u.test(tk);
      const primeiro = temLetra && !jaViuPalavra;
      if (temLetra) jaViuPalavra = true;
      return tokenNome(tk, primeiro);
    })
    .join(" ");
}

/** E-mail: minúsculo + trim (sem espaços internos). */
export function padronizarEmail(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\s+/g, "").toLocaleLowerCase("pt-BR");
}

/** Despacha pela natureza do campo. `livre` só apara (não muda o casing). */
export function normalizarTexto(valor: string | null | undefined, tipo: TipoTexto): string {
  const v = valor ?? "";
  switch (tipo) {
    case "email": return padronizarEmail(v);
    case "nome":
    case "cidade":
    case "endereco": return padronizarNome(v);
    case "livre": return apararTextoLivre(v);
  }
}

/**
 * Versão que preserva nulo/indefinido e devolve `null` quando sobra vazio — conveniente para os
 * campos opcionais dos schemas e da limpeza (não grava "" onde havia null).
 */
export function normalizarOpcional(valor: string | null | undefined, tipo: TipoTexto): string | null {
  if (valor === null || valor === undefined) return valor ?? null;
  const r = normalizarTexto(valor, tipo);
  return r === "" ? null : r;
}
