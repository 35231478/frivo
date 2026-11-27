/**
 * Tabela de preço — adicionar serviços e produtos EM MASSA: o filtro (texto + tipo), a caixa de cada linha e o
 * "selecionar todos" do filtro atual. Regras puras; a tela é components/cadastros/editores/editor-tabela-preco.
 */

export type TipoCatalogoTabela = "SERVICO" | "PRODUTO";
export interface ItemCatalogoTabela { id: string; nome: string; kind: TipoCatalogoTabela; codigo?: string | number | null }
export type FiltroTipo = "TODOS" | TipoCatalogoTabela;

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O que aparece para escolher: fora da tabela, do tipo pedido, com o texto no nome ou no código. */
export function filtrarCatalogo<T extends ItemCatalogoTabela>(catalogo: readonly T[], o: { q: string; tipo: FiltroTipo; jaNaTabela: ReadonlySet<string> }): T[] {
  const q = semAcento(o.q.trim());
  return catalogo.filter((c) => !o.jaNaTabela.has(c.id) && (o.tipo === "TODOS" || c.kind === o.tipo)
    && (!q || semAcento(c.nome).includes(q) || (c.codigo != null && semAcento(String(c.codigo)).includes(q))));
}

/** A caixa "Selecionar todos" do filtro atual: marcada, pela metade ou vazia. */
export function estadoDeTodos(selecionados: ReadonlySet<string>, visiveis: readonly { id: string }[]): "todos" | "alguns" | "nenhum" {
  const n = visiveis.filter((v) => selecionados.has(v.id)).length;
  return n === 0 ? "nenhum" : n === visiveis.length ? "todos" : "alguns";
}

/** Clicar em "Selecionar todos": marca todos os visíveis (ou, se já estavam todos, desmarca os visíveis). O resto fica. */
export function alternarTodos(selecionados: ReadonlySet<string>, visiveis: readonly { id: string }[]): Set<string> {
  const novo = new Set(selecionados);
  if (estadoDeTodos(selecionados, visiveis) === "todos") visiveis.forEach((v) => novo.delete(v.id));
  else visiveis.forEach((v) => novo.add(v.id));
  return novo;
}

/** Os escolhidos, na ordem do catálogo, sem os que já estão na tabela. */
export const escolhidos = <T extends ItemCatalogoTabela>(catalogo: readonly T[], selecionados: ReadonlySet<string>, jaNaTabela: ReadonlySet<string>) =>
  catalogo.filter((c) => selecionados.has(c.id) && !jaNaTabela.has(c.id));
