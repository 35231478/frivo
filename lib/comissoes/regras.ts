/**
 * COM-1 — COMISSÕES, as regras (sem banco e sem tela).
 *
 *  - REGRA em linhas: Quem (pessoa, cargo ou todos) · Papel (nesta leva só Vendedor) · Sobre (todos os serviços,
 *    categoria de serviço, um serviço ou peças) · Base (% da venda, % do lucro ou valor fixo por item) · Valor.
 *  - O ITEM MANDA, A PESSOA DESEMPATA (como a "comissão diferenciada" do OMIE, que vale sobre a fixa): um serviço >
 *    categoria > todos os serviços; no mesmo alvo, pessoa > cargo > todos. A primeira que casar vence.
 *    (Peças só valem para as linhas de peça/produto; serviço nunca pega regra de peça e vice-versa.)
 *  - A comissão nasce CONGELADA na aprovação do orçamento, por item: regra, base, taxa e valor daquele dia, e
 *    QUANDO fica devida (configuração da empresa naquele dia). Mudar a regra depois não mexe no passado.
 *  - LIBERAR é chegar ao "alvo" do gatilho: na aprovação (tudo), na conclusão da OS (tudo) ou no recebimento
 *    (proporcional ao que entrou). O alvo descendo (fatura cancelada, recebimento estornado, orçamento cancelado)
 *    vira ESTORNO automático — também na aprovação e na conclusão (COM-1.1: fatura cancelada estorna; proteção da empresa).
 *  - "% do lucro" só se calcula no servidor, com o custo que o vendedor não vê: a tela do vendedor recebe só o valor.
 */
import { z } from "zod";

export const QUEM = ["PESSOA", "CARGO", "TODOS"] as const;
export const PAPEIS = ["VENDEDOR", "EXECUTOR", "RESPONSAVEL"] as const;
/** Os papéis que já geram comissão (o modelo aceita o Responsável; a COM-2 ligou o Executor) */
export const PAPEIS_ATIVOS = ["VENDEDOR", "EXECUTOR"] as const;
export const SOBRE = ["TODOS_SERVICOS", "CATEGORIA", "SERVICO", "PECAS", "CONTRATOS"] as const;
export const BASES = ["PERC_VENDA", "PERC_LUCRO", "FIXO_ITEM", "PERC_MENSALIDADE", "FIXO_CONTRATO"] as const;
/** COM-1.2 — as bases que só existem em "Sobre: Contratos" (e lá só elas) */
export const BASES_CONTRATO = ["PERC_MENSALIDADE", "FIXO_CONTRATO"] as const;
/** COM-1.2 — os tipos de contrato (os do cadastro do contrato) */
export const TIPOS_CONTRATO = ["MANUTENCAO_PREVENTIVA", "MANUTENCAO_CORRETIVA", "MANUTENCAO_COMPLETA", "INSTALACAO", "LOCACAO", "ASSISTENCIA_TECNICA"] as const;
export type TipoContrato = (typeof TIPOS_CONTRATO)[number];
export const ROTULO_TIPO_CONTRATO: Record<TipoContrato, string> = {
  MANUTENCAO_PREVENTIVA: "Manutenção Preventiva", MANUTENCAO_CORRETIVA: "Manutenção Corretiva", MANUTENCAO_COMPLETA: "Manutenção Completa",
  INSTALACAO: "Instalação", LOCACAO: "Locação", ASSISTENCIA_TECNICA: "Assistência Técnica",
};
/** COM-1.2 — "% das mensalidades recebidas durante os primeiros N meses": o padrão e o limite (0 = enquanto ativo) */
export const MESES_PADRAO = 3;
export const MESES_MAX = 120;
export const QUANDO = ["RECEBIMENTO", "APROVACAO", "CONCLUSAO_OS"] as const;

export type Quem = (typeof QUEM)[number];
export type Papel = (typeof PAPEIS)[number];
export type Sobre = (typeof SOBRE)[number];
export type Base = (typeof BASES)[number];
export type Quando = (typeof QUANDO)[number];

export const ROTULO_QUEM: Record<Quem, string> = { PESSOA: "Pessoa", CARGO: "Cargo", TODOS: "Todos" };
export const ROTULO_PAPEL: Record<Papel, string> = { VENDEDOR: "Vendedor", EXECUTOR: "Executor", RESPONSAVEL: "Responsável" };
export const ROTULO_SOBRE: Record<Sobre, string> = { TODOS_SERVICOS: "Todos os serviços", CATEGORIA: "Categoria de serviço", SERVICO: "Um serviço", PECAS: "Peças", CONTRATOS: "Contratos" };
export const ROTULO_BASE: Record<Base, string> = {
  PERC_VENDA: "% da venda", PERC_LUCRO: "% do lucro", FIXO_ITEM: "Valor fixo por item",
  PERC_MENSALIDADE: "% das mensalidades recebidas", FIXO_CONTRATO: "Valor fixo no fechamento",
};
export const ROTULO_QUANDO: Record<Quando, string> = {
  RECEBIMENTO: "Por data de recebimento", APROVACAO: "Na aprovação do orçamento", CONCLUSAO_OS: "Na conclusão da OS",
};

/**
 * O relatório do mês visto por uma das duas datas: EMISSÃO = a parte da comissão coberta pelas faturas da venda
 * EMITIDAS no mês (COM-1.1, como no OMIE: a data da fatura/NF, não a aprovação — sem fatura emitida, não aparece);
 * RECEBIMENTO = a parte coberta pelo dinheiro que entrou no mês. É só a VISTA: o fechamento paga pelo "quando é devida".
 */
export const VISTAS = ["EMISSAO", "RECEBIMENTO"] as const;
export type Vista = (typeof VISTAS)[number];
export const ROTULO_VISTA: Record<Vista, string> = { EMISSAO: "Por data de emissão", RECEBIMENTO: "Por data de recebimento" };
/** A vista que abre: a do "quando é devida" (aprovação e conclusão da OS contam a partir da emissão da venda) */
export const vistaPadrao = (quando: Quando): Vista => (quando === "RECEBIMENTO" ? "RECEBIMENTO" : "EMISSAO");

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ───────── a regra ───────── */

export interface RegraComissao {
  id: string;
  quemTipo: Quem;
  usuarioId?: string | null;
  cargoId?: string | null;
  papel: Papel;
  sobreTipo: Sobre;
  categoria?: string | null;
  servicoId?: string | null;
  base: Base;
  valor: number;
  ativo?: boolean;
  /** COM-1.2 — "Sobre: Contratos" de um tipo só (nulo = todos os contratos) e a janela de meses (PERC_MENSALIDADE; 0 = enquanto ativo) */
  tipoContrato?: TipoContrato | null;
  meses?: number | null;
  /** COM-2 (Executor): como dividir entre os técnicos da atividade; POR_CARGO usa divisaoCargos ({ cargoId: % }) */
  divisao?: Divisao | null;
  divisaoCargos?: Record<string, number> | null;
}

/** COM-2: a divisão entre os técnicos (só no papel Executor) */
export const DIVISOES = ["IGUAL", "POR_EXECUTOR", "POR_CARGO"] as const;
export type Divisao = (typeof DIVISOES)[number];
export const ROTULO_DIVISAO: Record<Divisao, string> = { IGUAL: "Igual entre os técnicos", POR_EXECUTOR: "Para quem executou", POR_CARGO: "% por cargo" };

/** Quem recebe: o usuário e o cargo dele (do colaborador ligado pelo e-mail; null = sem cadastro de colaborador) */
export interface Beneficiario { usuarioId: string; cargoId: string | null }

/** Um item vendido, já com o desconto do grupo repartido. `custo` null = desconhecido. */
export interface ItemVenda {
  tipo: "SERVICO" | "PRODUTO";
  id: string;
  servicoId?: string | null;
  categoria?: string | null;
  descricao: string;
  quantidade: number;
  /** O valor com desconto, com a parte do ISS (o que o cliente paga por este item) */
  venda: number;
  /** O valor com desconto, sem o ISS ("líquido de impostos") */
  vendaLiquida: number;
  custo: number | null;
}

/** Categoria é texto livre: compara sem maiúscula e sem acento ("Instalacao" = "Instalação") */
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase("pt-BR");
const igualTexto = (a?: string | null, b?: string | null) => !!a && !!b && semAcento(a) === semAcento(b);

/** A regra vale para esta pessoa, neste papel, neste item? */
export function regraSeAplica(r: RegraComissao, pessoa: Beneficiario, item: Pick<ItemVenda, "tipo" | "servicoId" | "categoria">, papel: Papel): boolean {
  if (r.ativo === false || r.papel !== papel) return false;
  if (r.quemTipo === "PESSOA" && r.usuarioId !== pessoa.usuarioId) return false;
  if (r.quemTipo === "CARGO" && (!pessoa.cargoId || r.cargoId !== pessoa.cargoId)) return false;
  // COM-1.2: regra de contrato vale só para o contrato (lib/comissoes/contrato), nunca para um item de orçamento ou OS
  if (r.sobreTipo === "CONTRATOS") return false;
  if (item.tipo === "PRODUTO") return r.sobreTipo === "PECAS";
  if (r.sobreTipo === "PECAS") return false;
  if (r.sobreTipo === "SERVICO") return !!item.servicoId && r.servicoId === item.servicoId;
  if (r.sobreTipo === "CATEGORIA") return igualTexto(r.categoria, item.categoria);
  return true;
}

const PESO_QUEM: Record<Quem, number> = { PESSOA: 3, CARGO: 2, TODOS: 1 };
const PESO_SOBRE: Record<Sobre, number> = { SERVICO: 3, CATEGORIA: 2, TODOS_SERVICOS: 1, PECAS: 1, CONTRATOS: 1 };
/** COM-1.2 — o peso da regra de contrato: o tipo de contrato (específica) vence "todos os contratos" (geral); depois, pessoa > cargo > todos */
export const pesoDaRegraDeContrato = (r: Pick<RegraComissao, "quemTipo" | "tipoContrato">) => (r.tipoContrato ? 2 : 1) * 10 + PESO_QUEM[r.quemTipo];

/**
 * O peso da regra: primeiro SOBRE (o item: serviço > categoria > todos os serviços), depois QUEM (pessoa > cargo >
 * todos). Dá a ordem: pessoa + serviço, cargo + serviço, pessoa + categoria, cargo + categoria, pessoa + todos (o
 * "fixo" da pessoa), cargo + todos. "Todos" fecha cada nível. Peça só casa com regra de peça (lá decide o QUEM).
 */
export const pesoDaRegra = (r: Pick<RegraComissao, "quemTipo" | "sobreTipo">) => PESO_SOBRE[r.sobreTipo] * 10 + PESO_QUEM[r.quemTipo];

/** A ordem que a tela mostra (a primeira que casar vence) */
export const ORDEM_PRECEDENCIA = [
  "Pessoa + um serviço", "Cargo + um serviço", "Pessoa + categoria", "Cargo + categoria", "Pessoa + todos os serviços (o fixo)", "Cargo + todos os serviços",
] as const;

/** A regra que vale para o item: a mais específica entre as que se aplicam (null = sem comissão neste item). */
export function regraVencedora(regras: readonly RegraComissao[], pessoa: Beneficiario, item: Pick<ItemVenda, "tipo" | "servicoId" | "categoria">, papel: Papel = "VENDEDOR"): RegraComissao | null {
  let melhor: RegraComissao | null = null;
  for (const r of regras) {
    if (!regraSeAplica(r, pessoa, item, papel)) continue;
    // Empate de peso só acontece com regras repetidas (o servidor recusa): fica a de menor id, sempre a mesma
    if (!melhor || pesoDaRegra(r) > pesoDaRegra(melhor) || (pesoDaRegra(r) === pesoDaRegra(melhor) && r.id < melhor.id)) melhor = r;
  }
  return melhor;
}

/** Duas regras com a mesma chave disputariam o mesmo item: o servidor não deixa gravar a segunda. */
export function chaveDaRegra(r: Pick<RegraComissao, "papel" | "quemTipo" | "usuarioId" | "cargoId" | "sobreTipo" | "servicoId" | "categoria"> & Partial<Pick<RegraComissao, "tipoContrato" | "base">>): string {
  const quem = r.quemTipo === "PESSOA" ? r.usuarioId : r.quemTipo === "CARGO" ? r.cargoId : "*";
  // COM-1.2: no contrato, o "% das mensalidades" e o "fixo no fechamento" são partes separadas (podem valer as duas)
  if (r.sobreTipo === "CONTRATOS") return `${r.papel}|${r.quemTipo}:${quem}|CONTRATOS:${r.tipoContrato ?? "*"}:${r.base ?? ""}`;
  const sobre = r.sobreTipo === "SERVICO" ? r.servicoId : r.sobreTipo === "CATEGORIA" ? (r.categoria ?? "").trim().toLocaleLowerCase("pt-BR") : "*";
  return `${r.papel}|${r.quemTipo}:${quem}|${r.sobreTipo}:${sobre}`;
}

/* ───────── o valor ───────── */

export interface ValorComissao {
  /** A base em R$ (venda ou lucro) — só servidor */
  baseValor: number;
  taxa: number;
  valor: number;
  /** "% do lucro" com custo desconhecido: não se calcula (valor zero) */
  semCusto: boolean;
}

/**
 * O valor da comissão de um item pela regra. `liquidaImpostos` tira o ISS da venda. "% do lucro" = venda
 * líquida − custo (nunca negativo); custo desconhecido não calcula (zero — melhor que pagar sobre a venda inteira).
 */
export function valorDaComissao(r: Pick<RegraComissao, "base" | "valor">, item: Pick<ItemVenda, "venda" | "vendaLiquida" | "custo" | "quantidade">, liquidaImpostos: boolean): ValorComissao {
  const taxa = num(r.valor);
  if (r.base === "FIXO_ITEM") {
    const q = num(item.quantidade);
    return { baseValor: round2(q), taxa, valor: round2(taxa * q), semCusto: false };
  }
  if (r.base === "PERC_LUCRO") {
    if (item.custo == null) return { baseValor: 0, taxa, valor: 0, semCusto: true };
    const lucro = round2(Math.max(0, num(item.vendaLiquida) - num(item.custo)));
    return { baseValor: lucro, taxa, valor: round2(lucro * taxa / 100), semCusto: false };
  }
  const venda = round2(liquidaImpostos ? num(item.vendaLiquida) : num(item.venda));
  return { baseValor: venda, taxa, valor: round2(venda * taxa / 100), semCusto: false };
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** "Vendedores (cargo) · Instalação (categoria) · 5% da venda" — como a regra era (fica na comissão) */
export function descricaoDaRegra(r: RegraComissao, nomes: { pessoa?: string | null; cargo?: string | null; servico?: string | null } = {}): string {
  const quem = r.quemTipo === "PESSOA" ? `${nomes.pessoa ?? "Pessoa"} (pessoa)` : r.quemTipo === "CARGO" ? `${nomes.cargo ?? "Cargo"} (cargo)` : "Todos";
  const sobre = r.sobreTipo === "SERVICO" ? `${nomes.servico ?? "Serviço"} (serviço)` : r.sobreTipo === "CATEGORIA" ? `${r.categoria ?? ""} (categoria)`
    : r.sobreTipo === "CONTRATOS" ? (r.tipoContrato ? `Contratos de ${ROTULO_TIPO_CONTRATO[r.tipoContrato]}` : "Todos os contratos") : ROTULO_SOBRE[r.sobreTipo];
  const valor = r.base === "FIXO_ITEM" ? `${brl(num(r.valor))} por item` : r.base === "PERC_LUCRO" ? `${pct(num(r.valor))} do lucro`
    : r.base === "PERC_MENSALIDADE" ? `${pct(num(r.valor))} das mensalidades ${textoDosMeses(r.meses)}`
    : r.base === "FIXO_CONTRATO" ? `${brl(num(r.valor))} no fechamento` : `${pct(num(r.valor))} da venda`;
  return `${quem} · ${sobre} · ${valor}`;
}

/** COM-1.2 — "nos 3 primeiros meses" · "no 1º mês" · "enquanto o contrato estiver ativo" (0) */
export function textoDosMeses(meses: number | null | undefined): string {
  const m = Number.isInteger(meses) ? Number(meses) : MESES_PADRAO;
  if (m <= 0) return "enquanto o contrato estiver ativo";
  return m === 1 ? "no 1º mês" : `nos ${m} primeiros meses`;
}

/* ───────── a venda, item por item ───────── */

export interface LinhaOrcamento {
  id: string; servicoId?: string | null; categoria?: string | null; descricao: string; quantidade: unknown; valorTotal: unknown;
  /** Serviço: custo dos materiais inclusos (null = algum sem custo). Produto: custo × qtd (null = desconhecido) */
  custo: number | null;
}

/**
 * Os itens da venda com o desconto de cada grupo repartido pelo valor da linha, e o ISS (dos serviços) somado à
 * parte de cada um — o "valor com desconto" é o que o cliente paga por aquele item.
 */
export function itensDaVenda(o: {
  servicos: readonly LinhaOrcamento[]; produtos: readonly LinhaOrcamento[];
  descontoServicos: unknown; descontoProdutos: unknown; issAliquota: unknown;
}): ItemVenda[] {
  const subS = o.servicos.reduce((s, l) => s + num(l.valorTotal), 0);
  const subP = o.produtos.reduce((s, l) => s + num(l.valorTotal), 0);
  const fatorS = subS > 0 ? Math.max(0, subS - num(o.descontoServicos)) / subS : 0;
  const fatorP = subP > 0 ? Math.max(0, subP - num(o.descontoProdutos)) / subP : 0;
  const iss = Math.min(100, Math.max(0, num(o.issAliquota))) / 100;
  return [
    ...o.servicos.map((l): ItemVenda => {
      const liquida = round2(num(l.valorTotal) * fatorS);
      return { tipo: "SERVICO", id: l.id, servicoId: l.servicoId ?? null, categoria: l.categoria ?? null, descricao: l.descricao, quantidade: num(l.quantidade), venda: round2(liquida * (1 + iss)), vendaLiquida: liquida, custo: l.custo };
    }),
    ...o.produtos.map((l): ItemVenda => {
      const liquida = round2(num(l.valorTotal) * fatorP);
      return { tipo: "PRODUTO", id: l.id, servicoId: null, categoria: null, descricao: l.descricao, quantidade: num(l.quantidade), venda: liquida, vendaLiquida: liquida, custo: l.custo };
    }),
  ];
}

export interface ComissaoCalculada extends ValorComissao {
  item: ItemVenda;
  regra: RegraComissao;
}

/** As comissões de uma venda para o vendedor: um item, a regra que vence, o valor. Item sem regra (ou valor zero) fica de fora. */
export function comissoesDaVenda(itens: readonly ItemVenda[], regras: readonly RegraComissao[], pessoa: Beneficiario, liquidaImpostos: boolean, papel: Papel = "VENDEDOR"): ComissaoCalculada[] {
  const r: ComissaoCalculada[] = [];
  for (const item of itens) {
    const regra = regraVencedora(regras, pessoa, item, papel);
    if (!regra) continue;
    const v = valorDaComissao(regra, item, liquidaImpostos);
    if (v.valor <= 0) continue;
    r.push({ item, regra, ...v });
  }
  return r;
}

/* ───────── quando fica devida ───────── */

/** A venda ainda vale (aprovada ou já convertida); cancelada/recusada depois da aprovação = estorno */
export const VENDA_VIVA = ["APROVADO", "CONVERTIDA"] as const;

export interface FaturaRecebida {
  /** O valor desta fatura que é deste orçamento (o líquido × a parte dele nas linhas) */
  daVenda: number;
  /** O que a fatura cobra (as contas a receber) e o que já entrou dela */
  aCobrar: number;
  recebido: number;
}

/** Quanto da venda já entrou (0 a 1): o recebido de cada fatura, na proporção do que é desta venda, sobre o total da venda. */
export function fracaoRecebida(faturas: readonly FaturaRecebida[], totalVenda: number): number {
  if (num(totalVenda) <= 0) return 0;
  let entrou = 0;
  for (const f of faturas) {
    if (num(f.aCobrar) <= 0) continue;
    entrou += Math.min(1, Math.max(0, num(f.recebido) / num(f.aCobrar))) * num(f.daVenda);
  }
  return Math.min(1, Math.max(0, entrou / num(totalVenda)));
}

/** Uma entrada de dinheiro em reais desta venda, com a data */
export interface EntradaDaVenda { data: Date; valor: number }

/**
 * As entradas de uma fatura em reais DESTA venda: cada recebimento × (a parte da venda ÷ o que a fatura cobra),
 * na ordem das datas, sem passar do que a fatura tem desta venda (a soma bate com `fracaoRecebida`).
 */
export function entradasDaFatura(f: FaturaRecebida, brutas: readonly EntradaDaVenda[]): EntradaDaVenda[] {
  if (num(f.aCobrar) <= 0 || num(f.daVenda) <= 0) return [];
  const fator = num(f.daVenda) / num(f.aCobrar);
  let resta = num(f.daVenda);
  const r: EntradaDaVenda[] = [];
  for (const b of [...brutas].sort((x, y) => x.data.getTime() - y.data.getTime())) {
    const v = Math.min(resta, num(b.valor) * fator);
    if (v <= 0) break;
    r.push({ data: b.data, valor: v });
    resta -= v;
  }
  return r;
}

/** Quanto da venda (0 a 1) entrou ENTRE as datas [ini, fim): o relatório "por data de recebimento" */
export function fracaoRecebidaNoPeriodo(entradas: readonly EntradaDaVenda[], totalVenda: number, ini: Date, fim: Date): number {
  if (num(totalVenda) <= 0) return 0;
  const antes = entradas.filter((e) => e.data < ini).reduce((s, e) => s + num(e.valor), 0);
  const ate = entradas.filter((e) => e.data < fim).reduce((s, e) => s + num(e.valor), 0);
  // O que passa do total da venda (recebido a mais) não gera comissão a mais
  const cap = (v: number) => Math.min(1, Math.max(0, v / num(totalVenda)));
  return Math.max(0, cap(ate) - cap(antes));
}

/* ───────── as faturas da venda: cancelada? emitida quando? (COM-1.1) ───────── */

/** Uma fatura (medição) da venda, viva ou cancelada, com a data de emissão dela e o quanto é desta venda */
export interface FaturaDaVenda {
  /** Medição cancelada, ou todos os títulos dela cancelados/excluídos */
  cancelada: boolean;
  /** A emissão da fatura (`dataDeEmissao`); null = ainda não emitida (rascunho) */
  emitidaEm: Date | null;
  /** Em reais, o que a fatura cobra desta venda */
  daVenda: number;
}

/**
 * A fatura conta como CANCELADA para a comissão quando a medição foi cancelada OU todos os títulos dela foram
 * cancelados/excluídos. Sem título nenhum, não há o que cancelar: a fatura segue viva.
 */
export function faturaFoiCancelada(statusMedicao: string, titulos: readonly { cancelado: boolean }[]): boolean {
  return statusMedicao === "CANCELADA" || (titulos.length > 0 && titulos.every((t) => t.cancelado));
}

/** A venda perdeu a fatura: alguma foi cancelada e não sobrou nenhuma viva (refaturar devolve a comissão). */
export function vendaComFaturaCancelada(faturas: readonly Pick<FaturaDaVenda, "cancelada">[]): boolean {
  return faturas.some((f) => f.cancelada) && !faturas.some((f) => !f.cancelada);
}

/**
 * A DATA DE EMISSÃO da fatura, na ordem do que é mais "documento fiscal": a NFS-e autorizada (a mais antiga) >
 * a NF registrada à mão > a fatura enviada ao cliente > o primeiro título gerado. Nada disso = não emitida.
 */
export function dataDeEmissao(f: { nfseAutorizadas?: readonly (Date | null)[]; nfsRegistradas?: readonly Date[]; enviadaEm?: Date | null; titulosEm?: readonly Date[] }): Date | null {
  const primeira = (ds: readonly (Date | null | undefined)[] | undefined) =>
    (ds ?? []).filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return primeira(f.nfseAutorizadas) ?? primeira(f.nfsRegistradas) ?? (f.enviadaEm ?? null) ?? primeira(f.titulosEm);
}

/**
 * Quanto da venda (0 a 1) foi EMITIDO entre [ini, fim): as faturas vivas e emitidas, cada uma com a parte dela,
 * acumuladas na ordem da emissão sem passar do total da venda (faturar a mais não gera comissão a mais).
 */
export function fracaoEmitidaNoPeriodo(faturas: readonly FaturaDaVenda[], totalVenda: number, ini: Date, fim: Date): number {
  const emitidas = faturas.filter((f) => !f.cancelada && f.emitidaEm).map((f) => ({ data: f.emitidaEm as Date, valor: num(f.daVenda) }));
  return fracaoRecebidaNoPeriodo(emitidas, totalVenda, ini, fim);
}

/** A última emissão de fatura viva da venda no período (a data que o relatório mostra) */
export function ultimaEmissaoNoPeriodo(faturas: readonly FaturaDaVenda[], ini: Date, fim: Date): Date | null {
  const ds = faturas.filter((f) => !f.cancelada && f.emitidaEm && f.emitidaEm >= ini && f.emitidaEm < fim).map((f) => f.emitidaEm as Date);
  return ds.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

export interface EstadoDaVenda {
  statusOrcamento: string;
  /** A OS gerada do orçamento está concluída (e não cancelada) */
  osConcluida: boolean;
  /** 0 a 1 (RECEBIMENTO) */
  fracao: number;
  /** COM-1.1: a venda perdeu a fatura (cancelada, nenhuma viva) — estorna a comissão da aprovação e da conclusão */
  faturaCancelada?: boolean;
}

/** O ALVO liberado da comissão agora: o quanto do valor já é devido pelo gatilho congelado nela. */
export function alvoLiberado(c: { valor: number; quando: Quando }, e: EstadoDaVenda): number {
  const viva = (VENDA_VIVA as readonly string[]).includes(e.statusOrcamento) && !e.faturaCancelada;
  if (c.quando === "APROVACAO") return viva ? round2(c.valor) : 0;
  if (c.quando === "CONCLUSAO_OS") return viva && e.osConcluida ? round2(c.valor) : 0;
  // RECEBIMENTO: o dinheiro manda (o que entrou continua contando, mesmo que a venda mude depois)
  return round2(c.valor * Math.min(1, Math.max(0, e.fracao)));
}

/** O movimento que falta: + libera, − estorna, null = nada a fazer (diferença menor que 1 centavo). */
export function movimentoNecessario(alvo: number, jaLiberado: number): { tipo: "LIBERACAO" | "ESTORNO"; valor: number } | null {
  const d = round2(alvo - jaLiberado);
  if (Math.abs(d) < 0.01) return null;
  return d > 0 ? { tipo: "LIBERACAO", valor: d } : { tipo: "ESTORNO", valor: d };
}

/* ───────── o extrato (prevista / liberada / paga) ───────── */

export interface MovimentoExtrato { valor: number; pago: boolean }

/** Prevista = valor − o que já foi liberado (nunca negativa); Liberada = liberado e ainda não pago; Paga = já entrou num fechamento. */
export function situacaoDaComissao(valor: number, movimentos: readonly MovimentoExtrato[]) {
  const liberado = round2(movimentos.reduce((s, m) => s + num(m.valor), 0));
  const pago = round2(movimentos.filter((m) => m.pago).reduce((s, m) => s + num(m.valor), 0));
  return { prevista: round2(Math.max(0, num(valor) - liberado)), liberada: round2(liberado - pago), paga: pago };
}

/* ───────── o fechamento do mês ───────── */

/** O mês da competência ("AAAA-MM") → o primeiro dia do mês seguinte (UTC): entra tudo antes disso. */
export const inicioDaCompetencia = (competencia: string): Date => {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1));
};

export function fimDaCompetencia(competencia: string): Date {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1));
}

export interface ComissaoDaPessoa { usuarioId: string; nome: string; tecnicoId: string | null; valor: number }

/** Soma os movimentos em aberto por pessoa. Pessoa com saldo negativo (só estorno) não entra: o saldo fica para o mês seguinte. */
export function comissoesPorPessoa(movs: readonly { usuarioId: string | null; nome: string; tecnicoId: string | null; valor: number }[]): ComissaoDaPessoa[] {
  const por = new Map<string, ComissaoDaPessoa>();
  for (const m of movs) {
    if (!m.usuarioId) continue;
    const a = por.get(m.usuarioId) ?? { usuarioId: m.usuarioId, nome: m.nome, tecnicoId: m.tecnicoId, valor: 0 };
    a.valor = round2(a.valor + num(m.valor));
    por.set(m.usuarioId, a);
  }
  return [...por.values()].filter((p) => p.valor > 0).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/* ───────── o que a tela manda ───────── */

const PCT_MAX = 100;
/** O % de cada cargo na divisão (normalizado depois sobre os cargos presentes: 60/40 e 6/4 dão o mesmo) */
export const PCT_DIVISAO_MAX = 100;
export const MSG_PAPEL_INATIVO = "Por enquanto só os papéis Vendedor e Executor geram comissão.";
export const MSG_BASE_CONTRATO = "Em contratos, escolha \"% das mensalidades recebidas\" ou \"Valor fixo no fechamento\".";
export const MSG_BASE_SO_CONTRATO = "Esta base é só para contratos.";
export const MSG_CONTRATO_VENDEDOR = "Comissão sobre contrato é do vendedor.";
export const regraSchema = z.object({
  quemTipo: z.enum(QUEM),
  usuarioId: z.string().trim().min(1).nullish(),
  cargoId: z.string().trim().min(1).nullish(),
  papel: z.enum(PAPEIS).default("VENDEDOR"),
  sobreTipo: z.enum(SOBRE),
  categoria: z.string().trim().max(60).nullish(),
  servicoId: z.string().trim().min(1).nullish(),
  base: z.enum(BASES),
  valor: z.coerce.number({ invalid_type_error: "Informe o valor." }).min(0, "O valor não pode ser negativo."),
  ativo: z.boolean().optional(),
  /** COM-1.2: só em "Sobre: Contratos" */
  tipoContrato: z.enum(TIPOS_CONTRATO).nullish(),
  meses: z.coerce.number({ invalid_type_error: "Meses: número inteiro." }).int("Meses: número inteiro.").min(0, `Meses: de 0 a ${MESES_MAX}.`).max(MESES_MAX, `Meses: de 0 a ${MESES_MAX}.`).nullish(),
  /** COM-2: só no papel Executor */
  divisao: z.enum(DIVISOES).optional(),
  divisaoCargos: z.record(z.string().trim().min(1).max(64), z.coerce.number().min(0).max(PCT_DIVISAO_MAX)).nullish(),
}).strict().superRefine((r, ctx) => {
  const erro = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (!(PAPEIS_ATIVOS as readonly string[]).includes(r.papel)) erro("papel", MSG_PAPEL_INATIVO);
  if (r.papel === "EXECUTOR" && r.divisao === "POR_CARGO") {
    const pcts = Object.values(r.divisaoCargos ?? {});
    if (!pcts.length || pcts.every((v) => v <= 0)) erro("divisaoCargos", "Informe o % de pelo menos um cargo.");
  }
  if (r.quemTipo === "PESSOA" && !r.usuarioId) erro("usuarioId", "Escolha a pessoa.");
  if (r.quemTipo === "CARGO" && !r.cargoId) erro("cargoId", "Escolha o cargo.");
  if (r.sobreTipo === "CATEGORIA" && !r.categoria) erro("categoria", "Informe a categoria de serviço.");
  if (r.sobreTipo === "SERVICO" && !r.servicoId) erro("servicoId", "Escolha o serviço.");
  // COM-1.2: o contrato tem as bases dele (e só ele as tem); o vendedor é quem fecha o contrato
  const baseDeContrato = (BASES_CONTRATO as readonly string[]).includes(r.base);
  if (r.sobreTipo === "CONTRATOS" && !baseDeContrato) erro("base", MSG_BASE_CONTRATO);
  if (r.sobreTipo !== "CONTRATOS" && baseDeContrato) erro("base", MSG_BASE_SO_CONTRATO);
  if (r.sobreTipo === "CONTRATOS" && r.papel !== "VENDEDOR") erro("papel", MSG_CONTRATO_VENDEDOR);
  if (r.base !== "FIXO_ITEM" && r.base !== "FIXO_CONTRATO" && r.valor > PCT_MAX) erro("valor", "O percentual vai de 0 a 100.");
  if (r.valor <= 0) erro("valor", "Informe um valor maior que zero.");
});
export type RegraEntrada = z.infer<typeof regraSchema>;

/** Só o que vale para o tipo escolhido (o resto vai nulo para o banco) */
export function normalizarRegra(r: RegraEntrada) {
  return {
    quemTipo: r.quemTipo, papel: r.papel, sobreTipo: r.sobreTipo, base: r.base, valor: r.valor, ativo: r.ativo ?? true,
    usuarioId: r.quemTipo === "PESSOA" ? r.usuarioId ?? null : null,
    cargoId: r.quemTipo === "CARGO" ? r.cargoId ?? null : null,
    categoria: r.sobreTipo === "CATEGORIA" ? r.categoria?.trim() ?? null : null,
    servicoId: r.sobreTipo === "SERVICO" ? r.servicoId ?? null : null,
    // COM-1.2: o tipo de contrato só em "Sobre: Contratos"; a janela de meses só no "% das mensalidades" (padrão 3)
    tipoContrato: r.sobreTipo === "CONTRATOS" ? r.tipoContrato ?? null : null,
    meses: r.base === "PERC_MENSALIDADE" ? r.meses ?? MESES_PADRAO : null,
    // A divisão só existe no Executor (o vendedor é um só); "% por cargo" guarda só os cargos com % > 0
    divisao: r.papel === "EXECUTOR" ? r.divisao ?? "IGUAL" : "IGUAL",
    divisaoCargos: r.papel === "EXECUTOR" && r.divisao === "POR_CARGO"
      ? Object.fromEntries(Object.entries(r.divisaoCargos ?? {}).filter(([, v]) => v > 0))
      : null,
  };
}

/** COM-2: quando a comissão do TÉCNICO fica devida (o vendedor segue o `quando` da COM-1) */
export const QUANDO_EXECUTOR = ["CONCLUSAO_OS", "ACEITE", "RECEBIMENTO"] as const;
export type QuandoExecutor = (typeof QUANDO_EXECUTOR)[number];
export const ROTULO_QUANDO_EXECUTOR: Record<QuandoExecutor, string> = {
  CONCLUSAO_OS: "Na conclusão da OS", ACEITE: "No aceite do cliente", RECEBIMENTO: "No recebimento da OS",
};
export const RETORNO_DIAS_MAX = 365;

/* ───────── o vencimento da conta a pagar do fechamento (COM-1.1) ───────── */

export const VENCIMENTO_TIPOS = ["DIA_UTIL", "DIA_FIXO"] as const;
export type VencimentoTipo = (typeof VENCIMENTO_TIPOS)[number];
export interface VencimentoFechamento { tipo: VencimentoTipo; dia: number }
/** O padrão: 5º dia útil do mês seguinte à competência */
export const VENCIMENTO_PADRAO: VencimentoFechamento = { tipo: "DIA_UTIL", dia: 5 };
export const ROTULO_VENCIMENTO_TIPO: Record<VencimentoTipo, string> = { DIA_UTIL: "Dia útil", DIA_FIXO: "Dia fixo" };
/** Todo mês tem ao menos 20 dias úteis (seg–sex), e o dia fixo além do fim do mês cai no último dia */
export const MAX_DIA_UTIL = 20;
export const MAX_DIA_FIXO = 31;

export function lerVencimento(tipo: unknown, dia: unknown): VencimentoFechamento {
  const t = (VENCIMENTO_TIPOS as readonly unknown[]).includes(tipo) ? (tipo as VencimentoTipo) : VENCIMENTO_PADRAO.tipo;
  const max = t === "DIA_UTIL" ? MAX_DIA_UTIL : MAX_DIA_FIXO;
  const d = Number(dia);
  return { tipo: t, dia: Number.isInteger(d) && d >= 1 && d <= max ? d : Math.min(VENCIMENTO_PADRAO.dia, max) };
}

/** "5º dia útil do mês seguinte" / "Dia 10 do mês seguinte" */
export function descricaoDoVencimento(v: VencimentoFechamento): string {
  return v.tipo === "DIA_UTIL" ? `${v.dia}º dia útil do mês seguinte` : `Dia ${v.dia} do mês seguinte`;
}

/**
 * A data do vencimento no mês seguinte à competência ("AAAA-MM"), em UTC à meia-noite. Dia útil = segunda a
 * sexta (feriados não entram: não há cadastro de feriados). Dia fixo além do fim do mês = o último dia do mês.
 */
export function dataDoVencimento(competencia: string, v: VencimentoFechamento): Date {
  const [a, m] = competencia.split("-").map(Number);
  const ano = m === 12 ? a + 1 : a, mes = m === 12 ? 0 : m; // o mês seguinte (0–11)
  if (v.tipo === "DIA_FIXO") {
    const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ano, mes, Math.min(v.dia, ultimo)));
  }
  let uteis = 0;
  for (let d = 1; d <= 31; d++) {
    const data = new Date(Date.UTC(ano, mes, d));
    if (data.getUTCMonth() !== mes) break;
    const sem = data.getUTCDay();
    if (sem !== 0 && sem !== 6 && ++uteis === v.dia) return data;
  }
  return new Date(Date.UTC(ano, mes + 1, 0)); // (não acontece com o limite de 20)
}

export const configComissaoSchema = z.object({
  quando: z.enum(QUANDO),
  liquidaImpostos: z.boolean(),
  // COM-2 (opcionais: a tela antiga manda só os dois de cima)
  executorQuando: z.enum(QUANDO_EXECUTOR).optional(),
  retornoDias: z.coerce.number().int("Dias do retorno: número inteiro.").min(0, "Dias do retorno: de 0 a 365.").max(RETORNO_DIAS_MAX, "Dias do retorno: de 0 a 365.").optional(),
  /** Os tipos de OS que contam como retorno (a mesma lista do Desempenho: mudar aqui muda lá) */
  tiposRetorno: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  /** COM-1.1: o vencimento da conta a pagar do fechamento (sem os dois, fica como está) */
  vencimentoTipo: z.enum(VENCIMENTO_TIPOS).optional(),
  vencimentoDia: z.number().int("Informe um dia inteiro.").min(1, "O dia vai de 1 em diante.").optional(),
  /** COM-1.2: a renovação do contrato também gera comissão (abre um ciclo novo) */
  renovacaoGera: z.boolean().optional(),
}).strict().superRefine((c, ctx) => {
  if ((c.vencimentoTipo === undefined) !== (c.vencimentoDia === undefined)) ctx.addIssue({ code: "custom", message: "Informe o tipo e o dia do vencimento.", path: ["vencimentoDia"] });
  const max = c.vencimentoTipo === "DIA_UTIL" ? MAX_DIA_UTIL : MAX_DIA_FIXO;
  if (c.vencimentoDia !== undefined && c.vencimentoDia > max) ctx.addIssue({ code: "custom", message: c.vencimentoTipo === "DIA_UTIL" ? `O dia útil vai de 1 a ${MAX_DIA_UTIL}.` : `O dia vai de 1 a ${MAX_DIA_FIXO}.`, path: ["vencimentoDia"] });
});

export const MOTIVO_TROCA_MIN = 5;
export const trocarVendedorSchema = z.object({
  vendedorId: z.string().trim().min(1, "Escolha o vendedor."),
  motivo: z.string({ required_error: "Informe o motivo da troca." }).trim().min(MOTIVO_TROCA_MIN, `Informe o motivo da troca (mínimo ${MOTIVO_TROCA_MIN} caracteres).`).max(300),
}).strict();
