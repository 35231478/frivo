/**
 * Conciliação NF ↔ Pedido de Compra — regras puras (servidor, tela e testes usam as mesmas).
 *
 * Casamento POR ITEM (o item da NF atende uma quantidade do item do pedido, na unidade do produto):
 *  - item do pedido COM produto: casa com os itens da NF do MESMO produto (depois do de-para);
 *  - sem produto do lado do pedido ou da NF: pela semelhança da descrição (palavras em comum ≥ 50%);
 *  - a quantidade casada é o que falta no item do pedido, até o que sobra no item da NF.
 *
 * Pontuação (0–100) de cada pedido em aberto (Solicitado / Em cotação / Parcial):
 *   itens que batem ............ até 45 (proporção dos itens em aberto do pedido)
 *   quantidades cobertas ........ até 20 (proporção dos itens em aberto cobertos inteiros)
 *   fornecedor .................. 20 o mesmo da NF · 10 pedido sem fornecedor · 0 outro
 *   janela de datas ............. 5 NF até 60 dias depois do pedido · 2 mais que isso
 *                                  (NF ANTES do pedido = não é candidato)
 *   valor (NF × estimado) ....... 10 até 10% de diferença · 5 até 25% ou sem estimado · 0 mais
 * SUGERE a partir de 40 pontos (com pelo menos 1 item casado), no máximo 3, o idêntico primeiro e depois da
 * maior para a menor (empate: o pedido mais novo).
 * IDÊNTICO (vincula sozinho no lançamento, reversível): mesmo fornecedor + todos os itens do pedido
 * pelo produto + quantidades iguais + nenhum item da NF sobrando + pedido ainda sem NF — e só se
 * houver UM pedido idêntico (dois = ambíguo, só sugere).
 */

export const PEDIDO_ABERTO_PARA_NF = ["SOLICITADO", "COTANDO", "PARCIAL"] as const;
export const LIMIAR_DESCRICAO = 0.5;
export const LIMIAR_SUGESTAO = 40;
export const MAX_SUGESTOES = 3;
const EPS = 1e-6;
const DIA = 86_400_000;

export const arred2 = (n: number) => Math.round(n * 100) / 100;
export const arred4 = (n: number) => Math.round(n * 10_000) / 10_000;

// ───────────────────────── Semelhança da descrição ─────────────────────────

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "para", "com", "sem", "em", "no", "na", "por", "um", "uma", "e", "o", "a"]);

/** "Filtro Secador 1/4\" (Danfoss)" → ["filtro", "secador", "1", "4", "danfoss"] */
export function palavras(texto: string): string[] {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((p) => p && (p.length > 1 || /\d/.test(p)) && !PALAVRAS_VAZIAS.has(p));
}

/** Palavras em comum (Dice): 1 = mesmas palavras, 0 = nenhuma */
export function semelhanca(a: string, b: string): number {
  const A = new Set(palavras(a)), B = new Set(palavras(b));
  if (!A.size || !B.size) return 0;
  let comuns = 0;
  for (const p of A) if (B.has(p)) comuns++;
  return (2 * comuns) / (A.size + B.size);
}

// ───────────────────────── Casamento por item ─────────────────────────

export interface ItemPedidoConc {
  id: string; produtoId: string | null; descricao: string; quantidade: number; unidade: string;
  valorEstimado: number | null;
  /** já recebido de outras NFs (soma dos vínculos) */
  recebido: number;
}
export interface PedidoConc {
  id: string; numero: string; status: string; criadoEm: Date; fornecedorId: string | null; itens: ItemPedidoConc[];
}
export interface ItemNotaConc {
  id: string; numeroItem: number; produtoId: string | null; produtoNome: string | null; descricao: string;
  /** na unidade do produto (quantidade da NF × fator) */
  quantidade: number;
  /** custo por unidade do produto (valor unitário da NF ÷ fator) */
  valorUnitario: number;
  /** o que ainda não foi para nenhum pedido */
  disponivel: number;
}
export interface NotaConc { id: string; numero: string; fornecedorId: string; dataEmissao: Date; itens: ItemNotaConc[] }
export type Criterio = "PRODUTO" | "DESCRICAO";
export interface Par {
  pedidoItemId: string; notaItemId: string; quantidade: number; valorUnitario: number;
  criterio: Criterio; semelhanca: number;
}

/** O que falta receber no item do pedido */
export const faltaNoItem = (i: Pick<ItemPedidoConc, "quantidade" | "recebido">) => arred4(Math.max(0, i.quantidade - i.recebido));

/** Os pares item do pedido ↔ item da NF, com a quantidade de cada um (nunca passa do que falta nem do que sobra) */
export function casarItens(pedido: Pick<PedidoConc, "itens">, nota: Pick<NotaConc, "itens">): Par[] {
  const sobra = new Map(nota.itens.map((n) => [n.id, arred4(n.disponivel)]));
  const pares: Par[] = [];
  for (const pi of pedido.itens) {
    let falta = faltaNoItem(pi);
    if (falta <= EPS) continue;
    const candidatos = nota.itens.flatMap((n): { n: ItemNotaConc; criterio: Criterio; sem: number }[] => {
      if (pi.produtoId && n.produtoId) return n.produtoId === pi.produtoId ? [{ n, criterio: "PRODUTO", sem: 1 }] : [];
      const sem = Math.max(semelhanca(pi.descricao, n.descricao), n.produtoNome ? semelhanca(pi.descricao, n.produtoNome) : 0);
      return sem >= LIMIAR_DESCRICAO ? [{ n, criterio: "DESCRICAO", sem }] : [];
    }).sort((a, b) => b.sem - a.sem || a.n.numeroItem - b.n.numeroItem);
    for (const c of candidatos) {
      if (falta <= EPS) break;
      const resta = sobra.get(c.n.id)!;
      if (resta <= EPS) continue;
      const q = arred4(Math.min(resta, falta));
      pares.push({ pedidoItemId: pi.id, notaItemId: c.n.id, quantidade: q, valorUnitario: c.n.valorUnitario, criterio: c.criterio, semelhanca: arred2(c.sem) });
      sobra.set(c.n.id, arred4(resta - q));
      falta = arred4(falta - q);
    }
  }
  return pares;
}

// ───────────────────────── Pontuação ─────────────────────────

/** NF emitida no dia do pedido ou depois (1 dia de folga por causa do fuso) */
export const notaDepoisDoPedido = (dataEmissao: Date, criadoEm: Date) => dataEmissao.getTime() >= criadoEm.getTime() - DIA;

export interface Avaliacao {
  pedidoId: string; numero: string;
  pontos: number; identico: boolean; pares: Par[];
  itensAbertos: number; itensCasados: number; itensCobertos: number;
  /** por que sugeriu, em frases curtas (mostradas ao usuário) */
  motivos: string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const qtdTexto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/** Avalia um pedido para esta NF; null = não é candidato (NF antes do pedido, nada em aberto ou nada casa) */
export function avaliarPedido(pedido: PedidoConc, nota: NotaConc): Avaliacao | null {
  if (!(PEDIDO_ABERTO_PARA_NF as readonly string[]).includes(pedido.status)) return null;
  if (!notaDepoisDoPedido(nota.dataEmissao, pedido.criadoEm)) return null;
  const abertos = pedido.itens.filter((i) => faltaNoItem(i) > EPS);
  if (!abertos.length) return null;
  const pares = casarItens(pedido, nota);
  if (!pares.length) return null;

  const porItem = new Map<string, Par[]>();
  for (const p of pares) porItem.set(p.pedidoItemId, [...(porItem.get(p.pedidoItemId) ?? []), p]);
  const cobertos = abertos.filter((i) => arred4((porItem.get(i.id) ?? []).reduce((s, p) => s + p.quantidade, 0)) >= faltaNoItem(i) - EPS);

  // fornecedor
  const mesmoFornecedor = !!pedido.fornecedorId && pedido.fornecedorId === nota.fornecedorId;
  const ptsFornecedor = mesmoFornecedor ? 20 : pedido.fornecedorId ? 0 : 10;
  // datas
  const dias = Math.max(0, Math.floor((nota.dataEmissao.getTime() - pedido.criadoEm.getTime()) / DIA));
  const ptsData = dias <= 60 ? 5 : 2;
  // valor: só os pares com valor estimado no item do pedido
  const estimadoDe = new Map(pedido.itens.map((i) => [i.id, i.valorEstimado]));
  let estimado = 0, real = 0;
  for (const p of pares) {
    const e = estimadoDe.get(p.pedidoItemId);
    if (e == null) continue;
    estimado += e * p.quantidade;
    real += p.valorUnitario * p.quantidade;
  }
  const dif = estimado > 0 ? (real - estimado) / estimado : null;
  const ptsValor = dif == null ? 5 : Math.abs(dif) <= 0.1 + EPS ? 10 : Math.abs(dif) <= 0.25 + EPS ? 5 : 0;

  const pontos = Math.round(45 * (porItem.size / abertos.length) + 20 * (cobertos.length / abertos.length) + ptsFornecedor + ptsData + ptsValor);

  // idêntico: mesmo fornecedor, todos os itens pelo produto, quantidades iguais, nada da NF sobrando, pedido sem NF ainda
  const usadoDaNota = new Map<string, number>();
  for (const p of pares) usadoDaNota.set(p.notaItemId, arred4((usadoDaNota.get(p.notaItemId) ?? 0) + p.quantidade));
  const identico = mesmoFornecedor
    && pedido.itens.every((i) => i.recebido <= EPS)
    && cobertos.length === abertos.length
    && pares.every((p) => p.criterio === "PRODUTO")
    && nota.itens.every((n) => Math.abs((usadoDaNota.get(n.id) ?? 0) - n.quantidade) <= EPS);

  const nomeItem = new Map(pedido.itens.map((i) => [i.id, i.descricao]));
  const casadosTexto = [...porItem.entries()].map(([id, ps]) => {
    const p = ps[0];
    return `${nomeItem.get(id)} (${p.criterio === "PRODUTO" ? "produto" : `descrição parecida, ${pct(p.semelhanca)}`})`;
  });
  const motivos = [
    mesmoFornecedor ? "Mesmo fornecedor da NF" : pedido.fornecedorId ? "Fornecedor do pedido é outro" : "Pedido sem fornecedor definido",
    `${porItem.size} de ${abertos.length} ${abertos.length === 1 ? "item bate" : "itens batem"}: ${casadosTexto.join("; ")}`,
    cobertos.length === abertos.length
      ? "Quantidades: a NF cobre tudo o que falta"
      : `Quantidades: ${cobertos.length} de ${abertos.length} ${abertos.length === 1 ? "item coberto" : "itens cobertos"} inteiros (entrega parcial)`,
    dias === 0 ? "NF emitida no dia do pedido" : `NF emitida ${dias} ${dias === 1 ? "dia" : "dias"} depois do pedido`,
    dif == null ? "Pedido sem valor estimado para comparar"
      : Math.abs(dif) < 0.005 ? "Valor da NF igual ao estimado"
        : `Valor da NF ${pct(Math.abs(dif))} ${dif > 0 ? "acima" : "abaixo"} do estimado`,
  ];
  return {
    pedidoId: pedido.id, numero: pedido.numero, pontos, identico, pares,
    itensAbertos: abertos.length, itensCasados: porItem.size, itensCobertos: cobertos.length, motivos,
  };
}

/**
 * Pedidos sugeridos para a NF (≥ 40 pontos, até 3; o idêntico primeiro, depois a maior pontuação) e o que vincula sozinho:
 * o ÚNICO pedido idêntico (dois idênticos = ambíguo, ninguém vincula sozinho).
 */
export function sugerirPedidos(pedidos: PedidoConc[], nota: NotaConc): { sugestoes: Avaliacao[]; automatico: Avaliacao | null } {
  const avaliados = pedidos.map((p) => avaliarPedido(p, nota)).filter((a): a is Avaliacao => !!a);
  const identicos = avaliados.filter((a) => a.identico);
  const criado = new Map(pedidos.map((p) => [p.id, p.criadoEm.getTime()]));
  const sugestoes = avaliados.filter((a) => a.pontos >= LIMIAR_SUGESTAO)
    .sort((a, b) => Number(b.identico) - Number(a.identico) || b.pontos - a.pontos || criado.get(b.pedidoId)! - criado.get(a.pedidoId)!)
    .slice(0, MAX_SUGESTOES);
  return { sugestoes, automatico: identicos.length === 1 ? identicos[0] : null };
}

// ───────────────────────── Status e valor real ─────────────────────────

/** Sem nenhuma NF: "Em cotação" se o PC já foi baixado/enviado ao fornecedor; senão "Solicitado" */
export function statusSemNota(tiposEventos: readonly string[]): "SOLICITADO" | "COTANDO" {
  return tiposEventos.some((t) => t === "BAIXADO" || t.startsWith("ENVIADO_")) ? "COTANDO" : "SOLICITADO";
}

/** Concluída (tudo recebido), Parcial (parte) ou volta ao status sem NF (nada) */
export function statusPorCobertura(itens: readonly { quantidade: number; recebido: number }[], semNota: string): string {
  if (!itens.length || itens.every((i) => i.recebido <= EPS)) return semNota;
  return itens.every((i) => i.recebido >= i.quantidade - EPS) ? "CONCLUIDO" : "PARCIAL";
}

/** Valor real do item do pedido: média do custo das NFs vinculadas (ponderada pela quantidade); sem vínculo = o de antes */
export function valorRealDoItem(vinculos: readonly { quantidade: number; valorUnitario: number }[], anterior: number | null): number | null {
  const q = vinculos.reduce((s, v) => s + v.quantidade, 0);
  if (q <= EPS) return anterior;
  return arred2(vinculos.reduce((s, v) => s + v.quantidade * v.valorUnitario, 0) / q);
}

/** Linha do histórico do pedido: "NF 4610/1 vinculada: Filtro secador 4 un; Gás 2 kg — Parcial" */
export function textoVinculo(p: {
  nota: string; acao: "vinculada" | "desvinculada"; automatico?: boolean;
  itens: readonly { descricao: string; quantidade: number; unidade: string }[]; status: string;
}): string {
  const itens = p.itens.map((i) => `${i.descricao} ${qtdTexto(i.quantidade)} ${i.unidade}`).join("; ");
  const rotulo: Record<string, string> = { SOLICITADO: "Solicitado", COTANDO: "Em cotação", PARCIAL: "Parcial", CONCLUIDO: "Concluída" };
  return `NF ${p.nota} ${p.acao}${p.automatico ? " automaticamente (idêntica ao pedido)" : ""}: ${itens} — status ${rotulo[p.status] ?? p.status}`;
}
