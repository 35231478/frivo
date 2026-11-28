/**
 * REAJUSTE EM MASSA DA TABELA DE PREÇO (Leva I.2, item 6) — regras puras; a leitura e a gravação em
 * lib/precos/reajuste-tabela-server.
 *
 *  - % ou valor (R$), sobre TODOS os itens da tabela ou só os escolhidos; positivo aumenta, negativo reduz;
 *  - a base é o PREÇO ATUAL do item na tabela (o valor final gravado, o mesmo que trava o orçamento, a OS e a fatura);
 *  - arredonda em centavos; nenhum preço pode ficar negativo (o reajuste inteiro é recusado);
 *  - item por DESCONTO % (o preço segue o padrão do catálogo menos o desconto): o reajuste vale sobre o preço final
 *    e o item passa a VALOR FIXO com o preço novo. É o jeito mais simples e exato: o preço reajustado é o que se vê
 *    na prévia, sem arredondar um percentual de volta; "Desfazer reajuste" devolve o desconto original;
 *  - o lote guarda o antes e o depois de cada item. "Desfazer" volta o antes só nos itens que continuam como o lote
 *    os deixou; o item mudado depois (à mão, ou tirado da tabela) fica como está e aparece no aviso.
 *    O item é achado pelo serviço/produto (salvar a tabela no editor recria as linhas: o id da linha muda).
 */
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/precos/trava-tabela";
import { calcularValorFinalTabela } from "@/lib/tabela-preco-helpers";

export type TipoReajuste = "PERCENTUAL" | "VALOR";
export type TipoPreco = "VALOR_FIXO" | "DESCONTO_PERCENTUAL";

export interface PrecoDoItem {
  tipoPreco: TipoPreco;
  valorFixo: number | null;
  descontoPercent: number | null;
  valorFinal: number;
}

/** Um item da tabela como ele está agora */
export interface ItemDaTabela extends PrecoDoItem {
  id: string;
  servicoId: string | null;
  produtoId: string | null;
  descricao: string;
  /** O preço padrão do catálogo (a base do desconto %) */
  valorPadrao: number;
}

/** Uma linha do lote (o JSON de tabela_preco_reajustes.itens) e da prévia */
export interface LinhaReajuste {
  itemId: string;
  servicoId: string | null;
  produtoId: string | null;
  descricao: string;
  antes: PrecoDoItem;
  depois: PrecoDoItem;
}

export interface PedidoReajuste {
  tipo: TipoReajuste;
  valor: number;
  /** Ausente = todos os itens da tabela */
  itemIds?: readonly string[] | null;
}

export const PERCENTUAL_MIN = -99.99;
export const PERCENTUAL_MAX = 1000;

/** Arredonda em centavos (meio centavo para cima; o épsilon segura o 1,005 do ponto flutuante) */
export const centavos = (v: number) => Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100;
const iguais = (a: number | null, b: number | null) => (a == null || b == null ? a == b : Math.abs(a - b) < 0.005);

/** O preço novo de um preço atual */
export function precoReajustado(atual: number, tipo: TipoReajuste, valor: number): number {
  return centavos(tipo === "PERCENTUAL" ? atual * (1 + valor / 100) : atual + valor);
}

/** O que está errado no pedido (antes de olhar os itens); null = certo */
export function erroDoPedido(p: { tipo?: unknown; valor?: unknown; motivo?: unknown; itemIds?: unknown }): string | null {
  if (p.tipo !== "PERCENTUAL" && p.tipo !== "VALOR") return "Escolha o tipo do reajuste: percentual ou valor.";
  const v = Number(p.valor);
  if (p.valor === "" || p.valor == null || !Number.isFinite(v) || v === 0) return "Informe o valor do reajuste (diferente de zero).";
  if (p.tipo === "PERCENTUAL" && (v < PERCENTUAL_MIN || v > PERCENTUAL_MAX)) return `O percentual vai de ${PERCENTUAL_MIN}% a ${PERCENTUAL_MAX}%.`;
  if (p.tipo === "VALOR" && Math.abs(v) > 1_000_000) return "Valor do reajuste fora do limite.";
  if (p.itemIds != null && (!Array.isArray(p.itemIds) || !p.itemIds.length || p.itemIds.some((x) => typeof x !== "string")))
    return "Escolha ao menos um item para reajustar.";
  if (p.motivo !== undefined) {
    const m = typeof p.motivo === "string" ? p.motivo.trim() : "";
    if (m.length < MOTIVO_MIN) return `Informe o motivo do reajuste (ao menos ${MOTIVO_MIN} caracteres).`;
    if (m.length > MOTIVO_MAX) return `O motivo tem no máximo ${MOTIVO_MAX} caracteres.`;
  }
  return null;
}

/**
 * A prévia (e o lote): para cada item escolhido, o preço atual → o novo. Só entram os itens cujo preço muda.
 * Erro: item escolhido que não está na tabela, preço que ficaria negativo, nada muda.
 */
export function previaDoReajuste(itens: readonly ItemDaTabela[], p: PedidoReajuste): { ok: true; linhas: LinhaReajuste[] } | { ok: false; erro: string } {
  let alvo: readonly ItemDaTabela[] = itens;
  if (p.itemIds) {
    const porId = new Map(itens.map((i) => [i.id, i]));
    const faltam = p.itemIds.filter((id) => !porId.has(id));
    if (faltam.length) return { ok: false, erro: "Algum item escolhido não está mais na tabela. Feche e abra a tabela de novo." };
    alvo = [...new Set(p.itemIds)].map((id) => porId.get(id)!);
  }
  if (!alvo.length) return { ok: false, erro: "A tabela não tem itens para reajustar." };
  const linhas: LinhaReajuste[] = [];
  const negativos: string[] = [];
  for (const it of alvo) {
    const novo = precoReajustado(it.valorFinal, p.tipo, p.valor);
    if (novo < 0) { negativos.push(it.descricao); continue; }
    if (iguais(novo, it.valorFinal)) continue;
    linhas.push({
      itemId: it.id, servicoId: it.servicoId, produtoId: it.produtoId, descricao: it.descricao,
      antes: { tipoPreco: it.tipoPreco, valorFixo: it.valorFixo, descontoPercent: it.descontoPercent, valorFinal: it.valorFinal },
      depois: { tipoPreco: "VALOR_FIXO", valorFixo: novo, descontoPercent: null, valorFinal: novo },
    });
  }
  if (negativos.length) return { ok: false, erro: `O reajuste deixaria negativo o preço de ${negativos.join(", ")}.` };
  if (!linhas.length) return { ok: false, erro: "Nenhum preço muda com este reajuste." };
  return { ok: true, linhas };
}

const chaveDoItem = (x: { servicoId: string | null; produtoId: string | null }) => (x.servicoId ? `s:${x.servicoId}` : `p:${x.produtoId}`);
const mesmoPreco = (a: PrecoDoItem, b: PrecoDoItem) =>
  a.tipoPreco === b.tipoPreco && (a.tipoPreco === "VALOR_FIXO" ? iguais(a.valorFixo, b.valorFixo) : iguais(a.descontoPercent, b.descontoPercent));

export interface PlanoDesfazer {
  /** Os itens que voltam ao antes: o item de agora e o preço que ele recebe (o valor final do desconto % é recalculado) */
  voltam: { itemId: string; descricao: string; atual: number; preco: PrecoDoItem }[];
  /** Os que ficam como estão: mudaram depois do reajuste ou saíram da tabela */
  ignorados: { descricao: string; motivo: "alterado" | "removido" }[];
}

/** Desfazer um lote: volta o antes só nos itens que estão como o lote os deixou. */
export function planoDeDesfazer(lote: readonly LinhaReajuste[], atuais: readonly ItemDaTabela[]): PlanoDesfazer {
  const porChave = new Map(atuais.map((i) => [chaveDoItem(i), i]));
  const r: PlanoDesfazer = { voltam: [], ignorados: [] };
  for (const l of lote) {
    const it = porChave.get(chaveDoItem(l));
    if (!it) { r.ignorados.push({ descricao: l.descricao, motivo: "removido" }); continue; }
    if (!mesmoPreco(it, l.depois)) { r.ignorados.push({ descricao: it.descricao, motivo: "alterado" }); continue; }
    const a = l.antes;
    const valorFinal = calcularValorFinalTabela(a.tipoPreco, a.valorFixo, a.descontoPercent, it.valorPadrao);
    r.voltam.push({ itemId: it.id, descricao: it.descricao, atual: it.valorFinal, preco: { tipoPreco: a.tipoPreco, valorFixo: a.valorFixo, descontoPercent: a.descontoPercent, valorFinal } });
  }
  return r;
}

/** "10%", "-5,5%", "R$ 12,00", "-R$ 3,50" (o resumo do lote na tela) */
export function textoDoReajuste(tipo: TipoReajuste | string, valor: number): string {
  if (tipo === "PERCENTUAL") return `${valor > 0 ? "+" : ""}${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  const r = Math.abs(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
  return `${valor < 0 ? "-" : "+"}${r}`;
}

/** O aviso do desfazer quando há itens que ficam como estão */
export function avisoDosIgnorados(ignorados: PlanoDesfazer["ignorados"]): string | null {
  if (!ignorados.length) return null;
  const alt = ignorados.filter((i) => i.motivo === "alterado").map((i) => i.descricao);
  const rem = ignorados.filter((i) => i.motivo === "removido").map((i) => i.descricao);
  const partes = [
    alt.length && `${alt.join(", ")} ${alt.length > 1 ? "foram alterados" : "foi alterado"} depois do reajuste`,
    rem.length && `${rem.join(", ")} ${rem.length > 1 ? "saíram" : "saiu"} da tabela`,
  ].filter(Boolean);
  return `${partes.join("; ")}: ${ignorados.length > 1 ? "ficam" : "fica"} como ${ignorados.length > 1 ? "estão" : "está"}.`;
}
