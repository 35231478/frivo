/**
 * PREÇO DE TABELA TRAVADO (leva G, decisão do especialista aprovada pelo Zé).
 *
 * O preço que vem da tabela de preço do cliente (o que foi combinado em contrato) fica SEMPRE travado na OS e no
 * orçamento. Só quem tem a permissão "Alterar preço de tabela" (Orçamentos › alterarPrecoTabela; o
 * administrador tem) muda esse preço, e só informando o MOTIVO, que fica na trilha (o histórico do orçamento ou
 * da OS). Não há botão de destravar na tela: a empresa que quer flexibilidade dá a permissão pelo perfil.
 *
 * O servidor decide comparando com a tabela de AGORA, sem coluna nova:
 *  - item do catálogo que está na tabela do cliente, com valor diferente do da tabela → é "alteração de preço
 *    de tabela";
 *  - a não ser que o valor seja o MESMO já gravado antes para aquele item (salvar de novo um orçamento antigo,
 *    feito antes de a tabela mudar ou com uma alteração já autorizada, não pede tudo de novo).
 * Regras puras aqui; a leitura da tabela e a gravação da trilha em lib/precos/trava-tabela-server.
 */

export const PERMISSAO_PRECO_TABELA = ["orcamentos", "alterarPrecoTabela"] as const;
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 300;

export type TipoCatalogo = "servico" | "produto";
export const chaveCatalogo = (tipo: TipoCatalogo, id: string) => `${tipo}:${id}`;

export interface ItemComPreco {
  tipo: TipoCatalogo;
  catalogoId?: string | null;
  descricao: string;
  valorUnitario: number;
}

export interface AlteracaoPrecoTabela {
  descricao: string;
  valorTabela: number;
  valorNovo: number;
}

const iguais = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Os itens cujo preço foge da tabela do cliente. `tabela`: chave do catálogo → valor da tabela (vazio = cliente
 * sem tabela: nada é de tabela). `anteriores`: chave → valores já gravados antes (na edição).
 */
export function alteracoesDePrecoDeTabela(
  itens: readonly ItemComPreco[], tabela: ReadonlyMap<string, number>, anteriores: ReadonlyMap<string, readonly number[]> = new Map(),
): AlteracaoPrecoTabela[] {
  const r: AlteracaoPrecoTabela[] = [];
  for (const it of itens) {
    if (!it.catalogoId) continue;
    const k = chaveCatalogo(it.tipo, it.catalogoId);
    const valorTabela = tabela.get(k);
    if (valorTabela === undefined) continue;
    const novo = Number(it.valorUnitario);
    if (!Number.isFinite(novo) || iguais(novo, valorTabela)) continue;
    if ((anteriores.get(k) ?? []).some((v) => iguais(v, novo))) continue;
    r.push({ descricao: it.descricao, valorTabela, valorNovo: novo });
  }
  return r;
}

export type Veredito = { ok: true; motivo: string | null } | { ok: false; status: 400 | 403; erro: string };

/** Pode gravar? Sem alteração: sim. Com alteração: só com a permissão e um motivo. */
export function conferirPrecoDeTabela(alteracoes: readonly AlteracaoPrecoTabela[], o: { podeAlterar: boolean; motivo?: string | null }): Veredito {
  if (!alteracoes.length) return { ok: true, motivo: null };
  const itens = alteracoes.map((a) => a.descricao).join(", ");
  if (!o.podeAlterar) {
    return { ok: false, status: 403, erro: `O preço de ${itens} vem da tabela de preço do cliente e não pode ser alterado. Peça a quem tem a permissão "Alterar preço de tabela".` };
  }
  const motivo = (o.motivo ?? "").trim();
  if (motivo.length < MOTIVO_MIN) return { ok: false, status: 400, erro: `Informe o motivo da alteração do preço de tabela (${itens}).` };
  return { ok: true, motivo: motivo.slice(0, MOTIVO_MAX) };
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** A linha da trilha: "Preço de tabela alterado: Limpeza (R$ 150,00 → R$ 120,00). Motivo: …" */
export function textoDaTrilha(alteracoes: readonly AlteracaoPrecoTabela[], motivo: string): string {
  const itens = alteracoes.map((a) => `${a.descricao} (${reais(a.valorTabela)} → ${reais(a.valorNovo)})`).join("; ");
  return `Preço de tabela alterado: ${itens}. Motivo: ${motivo}`;
}
