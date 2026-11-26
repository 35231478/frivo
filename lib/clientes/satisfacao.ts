/**
 * SATISFAÇÃO do cliente = a média das notas que ele deu no ACEITE das OS (aceite.avaliacao, 1 a 5
 * estrelas — a mesma nota que alimenta o Desempenho), com a quantidade de avaliações.
 *
 * Antes era um campo de estrelas digitado à mão no cadastro (Cliente.satisfacao): quase ninguém
 * preenchia, e o que existia não tinha relação com o que o cliente respondeu. O campo antigo fica no
 * banco (nada é apagado), mas sai da tela.
 */

export interface ResumoSatisfacao {
  /** Média com uma casa (4,6); null sem nenhuma avaliação */
  media: number | null;
  avaliacoes: number;
}

export const SEM_AVALIACAO: ResumoSatisfacao = { media: null, avaliacoes: 0 };

/** Só notas válidas (inteiras de 1 a 5) entram na conta. */
export function resumoSatisfacao(notas: readonly (number | null | undefined)[]): ResumoSatisfacao {
  const validas = notas.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5);
  if (!validas.length) return SEM_AVALIACAO;
  const media = validas.reduce((s, n) => s + n, 0) / validas.length;
  return { media: Math.round(media * 10) / 10, avaliacoes: validas.length };
}

/** Agrupa as notas por cliente (as linhas vêm do aceite, com o cliente da OS). */
export function satisfacaoPorCliente(linhas: readonly { clienteId: string; avaliacao: number | null }[]): Map<string, ResumoSatisfacao> {
  const notas = new Map<string, number[]>();
  for (const l of linhas) {
    if (l.avaliacao == null) continue;
    notas.set(l.clienteId, [...(notas.get(l.clienteId) ?? []), l.avaliacao]);
  }
  return new Map([...notas].map(([id, ns]) => [id, resumoSatisfacao(ns)]));
}

/** "4,6" (uma casa, vírgula) */
export const mediaTexto = (media: number) => media.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "1 avaliação" / "12 avaliações" */
export const avaliacoesTexto = (n: number) => `${n} ${n === 1 ? "avaliação" : "avaliações"}`;
