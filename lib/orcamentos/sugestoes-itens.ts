/**
 * SUGESTÕES DE ITEM DO ORÇAMENTO (Princípio 9: sugere, não preenche no escuro).
 *
 * Ao escolher o cliente, a tela oferece o que o histórico DELE mostra: os serviços e produtos que
 * mais entraram nos orçamentos dele, cada um com o ÚLTIMO preço praticado para ele.
 *
 * Regras (as mesmas na tela e no servidor, irmãs das sugestões da abertura da OS):
 *  - só olha os últimos JANELA_MESES meses;
 *  - conta ORÇAMENTOS DISTINTOS, não linhas: o mesmo serviço repetido em três linhas do mesmo
 *    orçamento é UM orçamento, não três;
 *  - só sugere o que apareceu em pelo menos MINIMO_ORCAMENTOS do período (histórico fino não sugere);
 *  - o preço é o da linha mais recente (o último praticado), nunca uma média;
 *  - no máximo MAXIMO_SUGESTOES, dos mais usados para os menos usados; empate desempata pelo mais
 *    recente, e quem não cabe simplesmente não aparece;
 *  - a sugestão é sempre editável e a tela diz de onde veio.
 */

export const JANELA_MESES = 6;
export const MINIMO_ORCAMENTOS = 2;
export const MAXIMO_SUGESTOES = 5;

export type TipoItem = "SERVICO" | "PRODUTO";

/** Uma linha de orçamento do histórico do cliente. */
export interface LinhaDoHistorico {
  orcamentoId: string;
  tipo: TipoItem;
  /** Item do catálogo (serviço ou produto); nulo = linha escrita à mão */
  catalogoId: string | null;
  descricao: string;
  valorUnitario: number;
  /** Data do orçamento (a mais recente manda no preço) */
  criadoEm: Date;
}

/** Um item sugerido: o que é, por que apareceu e o último preço praticado. */
export interface SugestaoItem {
  tipo: TipoItem;
  catalogoId: string | null;
  descricao: string;
  valorUnitario: number;
  /** Em quantos orçamentos do período ele apareceu (o motivo que a tela mostra) */
  vezes: number;
  /** Data do orçamento de onde saiu o preço */
  ultimaEm: Date;
}

/** O instante a partir do qual o histórico conta (janela móvel de JANELA_MESES). */
export function inicioDaJanela(agora: Date = new Date()): Date {
  const d = new Date(agora);
  d.setMonth(d.getMonth() - JANELA_MESES);
  return d;
}

/** A chave do item: o do catálogo é o mesmo item em qualquer orçamento; o escrito à mão vale pelo texto. */
export function chaveDoItem(l: Pick<LinhaDoHistorico, "tipo" | "catalogoId" | "descricao">): string {
  return l.catalogoId
    ? `${l.tipo}:cat:${l.catalogoId}`
    : `${l.tipo}:txt:${l.descricao.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * As sugestões do cliente a partir das linhas do histórico (em qualquer ordem).
 * Devolve lista vazia quando nada repete o bastante — a tela então não mostra nada.
 */
export function sugestoesDoHistorico(
  linhas: readonly LinhaDoHistorico[],
  opcoes: { minimo?: number; maximo?: number } = {},
): SugestaoItem[] {
  const minimo = opcoes.minimo ?? MINIMO_ORCAMENTOS;
  const maximo = opcoes.maximo ?? MAXIMO_SUGESTOES;

  const porItem = new Map<string, { orcamentos: Set<string>; recente: LinhaDoHistorico }>();
  for (const l of linhas) {
    if (!l.descricao.trim()) continue;
    const k = chaveDoItem(l);
    const atual = porItem.get(k);
    if (!atual) {
      porItem.set(k, { orcamentos: new Set([l.orcamentoId]), recente: l });
      continue;
    }
    atual.orcamentos.add(l.orcamentoId);
    // o preço é o da linha mais recente; empate de data mantém a primeira vista
    if (l.criadoEm.getTime() > atual.recente.criadoEm.getTime()) atual.recente = l;
  }

  return [...porItem.values()]
    .filter((i) => i.orcamentos.size >= minimo)
    .map<SugestaoItem>((i) => ({
      tipo: i.recente.tipo,
      catalogoId: i.recente.catalogoId,
      descricao: i.recente.descricao,
      valorUnitario: i.recente.valorUnitario,
      vezes: i.orcamentos.size,
      ultimaEm: i.recente.criadoEm,
    }))
    .sort((a, b) => b.vezes - a.vezes || b.ultimaEm.getTime() - a.ultimaEm.getTime() || a.descricao.localeCompare(b.descricao, "pt-BR"))
    .slice(0, maximo);
}

/** O texto que a tela mostra para explicar de onde veio a sugestão. */
export function motivoDaSugestao(s: Pick<SugestaoItem, "vezes">): string {
  return `${s.vezes} orçamentos deste cliente nos últimos ${JANELA_MESES} meses`;
}
