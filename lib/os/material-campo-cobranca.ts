/**
 * Leva I.2 — MATERIAL DE CAMPO NO "COBRADO À PARTE" (regra pura; o banco está em ./material-campo-cobranca-server).
 *
 * Com a regra de cobrança da OS = A_PARTE ("Orçamento E2"), o material que o técnico lança no app vira ITEM COBRADO
 * da OS: item PRODUTO, a quantidade usada e o preço de VENDA (tabela do cliente ou o padrão do catálogo; material
 * fora do catálogo entra com 0 e pede o preço na conferência). Ele nasce "a conferir" (`conferirCampo`):
 *  - enquanto não conferido, corrigir o uso em campo atualiza a quantidade do item e remover o uso tira o item;
 *  - o escritório confere na aba da OS: Confirmar (pode ajustar preço e quantidade) ou Excluir da cobrança;
 *  - faturar a OS com item a conferir é bloqueado.
 * Modo INCLUSO: nada muda (o material continua só no registro e no estoque).
 * Um uso nunca vira dois itens: o item guarda o uso (`materialCampoId`, único) e só nasce na 1ª gravação do uso.
 */
import { round2 } from "@/lib/orcamentos/calculo";
import { TRAVA_FATURADO, TRAVA_NOTA, type SituacaoDoRegistro } from "@/lib/edicao-contexto";
import type { CobrancaMateriais } from "@/lib/orcamentos/materiais";

export const ROTULO_A_CONFERIR = "Material de campo a conferir";
export const ETIQUETA_CAMPO = "Material de campo";
export const DICA_A_CONFERIR = "Lançado pelo técnico no app. Com materiais cobrados à parte, o uso em campo vira item da OS; confira o preço e a quantidade antes de faturar.";
export const MSG_TRAVA_FATURAR_CAMPO = "Há material de campo a conferir nesta OS: confirme ou exclua da cobrança cada item em Comercial › Itens da OS antes de faturar.";
export const MSG_PRECO_CAMPO = "Informe o preço de venda (maior que zero).";
export const MSG_QTD_CAMPO = "Informe a quantidade (maior que zero).";
export const MSG_JA_CONFERIDO = "Este material de campo já foi conferido.";
export const MSG_USE_CONFERENCIA = "Material de campo a conferir: use Confirmar ou Excluir da cobrança.";

/** O uso em campo entra na cobrança? Só no "Cobrado à parte", e nunca o que consome um material já cobrado na OS. */
export function deveCobrarUsoCampo(p: { regra: CobrancaMateriais; jaCobradoNaOs: boolean; trava: string | null }): boolean {
  return p.regra === "A_PARTE" && !p.jaCobradoNaOs && !p.trava;
}

/**
 * A trava da cobrança do campo: só o que já foi faturado (fatura/medição ou nota). A assinatura do cliente não trava
 * a conferência — senão o item a conferir de uma OS assinada nunca sairia e a OS nunca seria faturada.
 */
export function travaDoCampo(s: SituacaoDoRegistro | null | undefined): string | null {
  if (s?.notaEmitida) return TRAVA_NOTA;
  if (s?.faturado) return TRAVA_FATURADO;
  return null;
}

/** Quantidade do item (2 casas, como a coluna do item da OS) */
export const quantidadeDoItem = (q: number) => round2(q);

export interface ItemCampoAtual { quantidade: number; valorUnitario: number; conferirCampo: boolean }
export type PlanoItemCampo =
  | { acao: "nada" }
  | { acao: "remover" }
  | { acao: "atualizar"; quantidade: number; valorTotal: number };

/**
 * O que acontece com o item quando o uso em campo muda (corrigido ou removido). Já conferido: nada (o escritório
 * decidiu; o campo não mexe mais na cobrança). Sem item: nada (só a 1ª gravação cria).
 */
export function planoDoItemCampo(item: ItemCampoAtual | null, uso: { quantidade: number; removido: boolean }): PlanoItemCampo {
  if (!item || !item.conferirCampo) return { acao: "nada" };
  if (uso.removido || !(uso.quantidade > 0)) return { acao: "remover" };
  const quantidade = quantidadeDoItem(uso.quantidade);
  if (quantidade === item.quantidade) return { acao: "nada" };
  return { acao: "atualizar", quantidade, valorTotal: round2(quantidade * item.valorUnitario) };
}

/** A conferência: o que o escritório confirma (ajuste opcional de quantidade e preço). Erro = mensagem. */
export function lerConferencia(item: { quantidade: number; valorUnitario: number }, d: { quantidade?: unknown; valorUnitario?: unknown }):
  { ok: true; quantidade: number; valorUnitario: number; valorTotal: number } | { ok: false; erro: string } {
  const quantidade = d.quantidade === undefined || d.quantidade === null || d.quantidade === "" ? item.quantidade : quantidadeDoItem(Number(d.quantidade));
  const valorUnitario = d.valorUnitario === undefined || d.valorUnitario === null || d.valorUnitario === "" ? item.valorUnitario : round2(Number(d.valorUnitario));
  if (!Number.isFinite(quantidade) || !(quantidade > 0) || quantidade > 1e7) return { ok: false, erro: MSG_QTD_CAMPO };
  if (!Number.isFinite(valorUnitario) || !(valorUnitario > 0) || valorUnitario > 1e8) return { ok: false, erro: MSG_PRECO_CAMPO };
  return { ok: true, quantidade, valorUnitario, valorTotal: round2(quantidade * valorUnitario) };
}

/** A trava do faturamento da OS */
export const travaFaturarCampo = (aConferir: number) => (aConferir > 0 ? MSG_TRAVA_FATURAR_CAMPO : null);
