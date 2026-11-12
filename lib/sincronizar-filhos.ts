/**
 * Edição de listas filhas com histórico (campos de formulário, itens de checklist de veículo)
 * SEM apagar nada: respostas e checklists já preenchidos apontam para esses registros.
 *
 * Compara o que existe no banco com o que veio da tela:
 * - veio com `id` de um registro deste pai → ATUALIZA no lugar (se estava inativo, reativa);
 * - veio sem `id` → CRIA;
 * - existia ativo e não veio mais → INATIVA (ativo=false; continua no banco e no histórico).
 * - VERSIONA: veio com `id`, mas o registro já tem respostas e o conteúdo mudou (pergunta, tipo,
 *   opções) → o antigo é INATIVADO (as respostas seguem com a pergunta original) e entra um NOVO.
 *   Mudar só ordem/obrigatoriedade atualiza no lugar.
 * `id` que não é deste pai (ou repetido) → inválido: a rota recusa sem gravar nada.
 */
export interface PlanoFilhos<T> {
  atualizar: (T & { id: string })[];
  criar: Omit<T, "id">[];
  inativar: string[];
  invalidos: string[];
}

export function planejarFilhos<E extends { id: string; ativo: boolean }, T extends { id?: string | null }>(
  existentes: readonly E[], enviados: readonly T[],
  opts: { versionar?: (existente: E, enviado: T) => boolean } = {},
): PlanoFilhos<T> {
  const doPai = new Map(existentes.map((e) => [e.id, e]));
  const vistos = new Set<string>();
  const versionados = new Set<string>();
  const plano: PlanoFilhos<T> = { atualizar: [], criar: [], inativar: [], invalidos: [] };
  for (const item of enviados) {
    const { id, ...resto } = item;
    if (!id) { plano.criar.push(resto as Omit<T, "id">); continue; }
    const existente = doPai.get(id);
    if (!existente || vistos.has(id)) { plano.invalidos.push(id); continue; }
    vistos.add(id);
    if (opts.versionar?.(existente, item)) { versionados.add(id); plano.criar.push(resto as Omit<T, "id">); continue; }
    plano.atualizar.push({ ...item, id });
  }
  plano.inativar = existentes.filter((e) => (e.ativo && !vistos.has(e.id)) || versionados.has(e.id)).map((e) => e.id);
  return plano;
}

/** Compara conteúdo (texto, listas, JSON) ignorando diferença entre null e undefined. */
export const mesmoConteudo = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
