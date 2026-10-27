/**
 * Códigos de produto e serviço — regras puras (a tela, o servidor, a planilha e o SQL de backfill
 * seguem as mesmas):
 *  - produto: número inteiro sequencial por empresa (1, 2, 3…), gerado ao criar; único na empresa;
 *  - serviço: alfanumérico, gerado ao criar pelas 4 primeiras letras do nome (sem acento; sem letras =
 *    "SRV") + sequencial de 2 dígitos por prefixo (LIMP01, LIMP02…); editável; único na empresa.
 */

export const CODIGO_SERVICO_MAX = 20;
export const PREFIXO_SERVICO_PADRAO = "SRV";

/** "Limpeza de Filtro" → "LIMP"; "Ar" → "AR"; "123" → "SRV" */
export function prefixoCodigoServico(nome: string): string {
  const letras = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
  return letras.slice(0, 4) || PREFIXO_SERVICO_PADRAO;
}

/** ("LIMP", 2) → "LIMP02"; ("LIMP", 100) → "LIMP100" (nunca corta) */
export const codigoServico = (prefixo: string, n: number) => `${prefixo}${n < 100 ? String(n).padStart(2, "0") : String(n)}`;

/** O próximo código do prefixo, continuando do MAIOR já usado com ele (os outros códigos não contam) */
export function proximoCodigoServico(nome: string, existentes: readonly (string | null | undefined)[]): string {
  const prefixo = prefixoCodigoServico(nome);
  const re = new RegExp(`^${prefixo}(\\d{1,6})$`);
  const maior = existentes.reduce((m, c) => { const x = c ? re.exec(c) : null; return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return codigoServico(prefixo, maior + 1);
}

/**
 * Código digitado do serviço: sem acento, maiúsculas, sem espaços. Só letras e números (1 a 20).
 * Vazio → null (o sistema gera). Inválido → mensagem.
 */
export function normalizarCodigoServico(v: unknown): { codigo: string | null; erro?: string } {
  if (v === undefined || v === null) return { codigo: null };
  const t = String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, "");
  if (!t) return { codigo: null };
  if (!/^[A-Z0-9]+$/.test(t)) return { codigo: null, erro: `Código “${String(v).trim()}”: use só letras e números (ex.: LIMP01).` };
  if (t.length > CODIGO_SERVICO_MAX) return { codigo: null, erro: `Código: no máximo ${CODIGO_SERVICO_MAX} caracteres.` };
  return { codigo: t };
}

/** Código do produto digitado/na planilha: inteiro positivo. Vazio → null. */
export function normalizarCodigoProduto(v: unknown): { codigo: number | null; erro?: string } {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return { codigo: null };
  const t = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(t) || t < 1 || t > 2_000_000_000) return { codigo: null, erro: `Código “${String(v).trim()}”: o código do produto é um número inteiro (ex.: 15).` };
  return { codigo: t };
}

/** "15 · Gás R410A" / "LIMP01 · Limpeza de filtro" (seletores e sugestões) */
export const rotuloComCodigo = (codigo: string | number | null | undefined, nome: string) =>
  codigo === null || codigo === undefined || codigo === "" ? nome : `${codigo} · ${nome}`;

/** A busca por texto também acha pelo código (número exato do produto; início do código do serviço) */
export function casaCodigo(codigo: string | number | null | undefined, q: string): boolean {
  if (codigo === null || codigo === undefined) return false;
  const t = q.trim().toUpperCase();
  if (!t) return false;
  return typeof codigo === "number" ? /^\d+$/.test(t) && Number(t) === codigo : codigo.toUpperCase().startsWith(t);
}
