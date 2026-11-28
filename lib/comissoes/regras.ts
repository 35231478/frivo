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
 *    vira ESTORNO automático.
 *  - "% do lucro" só se calcula no servidor, com o custo que o vendedor não vê: a tela do vendedor recebe só o valor.
 */
import { z } from "zod";

export const QUEM = ["PESSOA", "CARGO", "TODOS"] as const;
export const PAPEIS = ["VENDEDOR", "EXECUTOR", "RESPONSAVEL"] as const;
/** Os papéis que já geram comissão (o modelo aceita os outros; a COM-2 liga o Executor) */
export const PAPEIS_ATIVOS = ["VENDEDOR"] as const;
export const SOBRE = ["TODOS_SERVICOS", "CATEGORIA", "SERVICO", "PECAS"] as const;
export const BASES = ["PERC_VENDA", "PERC_LUCRO", "FIXO_ITEM"] as const;
export const QUANDO = ["RECEBIMENTO", "APROVACAO", "CONCLUSAO_OS"] as const;

export type Quem = (typeof QUEM)[number];
export type Papel = (typeof PAPEIS)[number];
export type Sobre = (typeof SOBRE)[number];
export type Base = (typeof BASES)[number];
export type Quando = (typeof QUANDO)[number];

export const ROTULO_QUEM: Record<Quem, string> = { PESSOA: "Pessoa", CARGO: "Cargo", TODOS: "Todos" };
export const ROTULO_PAPEL: Record<Papel, string> = { VENDEDOR: "Vendedor", EXECUTOR: "Executor", RESPONSAVEL: "Responsável" };
export const ROTULO_SOBRE: Record<Sobre, string> = { TODOS_SERVICOS: "Todos os serviços", CATEGORIA: "Categoria de serviço", SERVICO: "Um serviço", PECAS: "Peças" };
export const ROTULO_BASE: Record<Base, string> = { PERC_VENDA: "% da venda", PERC_LUCRO: "% do lucro", FIXO_ITEM: "Valor fixo por item" };
export const ROTULO_QUANDO: Record<Quando, string> = {
  RECEBIMENTO: "Por data de recebimento", APROVACAO: "Por data de emissão (aprovação do orçamento)", CONCLUSAO_OS: "Na conclusão da OS",
};

/**
 * O relatório do mês visto por uma das duas datas (o mesmo conceito do "quando é devida"): EMISSÃO = vendas
 * emitidas (orçamento aprovado) no mês, com a comissão inteira; RECEBIMENTO = a parte da comissão coberta pelo
 * dinheiro que entrou no mês. É só a VISTA: o que o fechamento paga segue a configuração da empresa.
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
}

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
  if (item.tipo === "PRODUTO") return r.sobreTipo === "PECAS";
  if (r.sobreTipo === "PECAS") return false;
  if (r.sobreTipo === "SERVICO") return !!item.servicoId && r.servicoId === item.servicoId;
  if (r.sobreTipo === "CATEGORIA") return igualTexto(r.categoria, item.categoria);
  return true;
}

const PESO_QUEM: Record<Quem, number> = { PESSOA: 3, CARGO: 2, TODOS: 1 };
const PESO_SOBRE: Record<Sobre, number> = { SERVICO: 3, CATEGORIA: 2, TODOS_SERVICOS: 1, PECAS: 1 };

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
export function chaveDaRegra(r: Pick<RegraComissao, "papel" | "quemTipo" | "usuarioId" | "cargoId" | "sobreTipo" | "servicoId" | "categoria">): string {
  const quem = r.quemTipo === "PESSOA" ? r.usuarioId : r.quemTipo === "CARGO" ? r.cargoId : "*";
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
  const sobre = r.sobreTipo === "SERVICO" ? `${nomes.servico ?? "Serviço"} (serviço)` : r.sobreTipo === "CATEGORIA" ? `${r.categoria ?? ""} (categoria)` : ROTULO_SOBRE[r.sobreTipo];
  const valor = r.base === "FIXO_ITEM" ? `${brl(num(r.valor))} por item` : r.base === "PERC_LUCRO" ? `${pct(num(r.valor))} do lucro` : `${pct(num(r.valor))} da venda`;
  return `${quem} · ${sobre} · ${valor}`;
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

export interface EstadoDaVenda {
  statusOrcamento: string;
  /** A OS gerada do orçamento está concluída (e não cancelada) */
  osConcluida: boolean;
  /** 0 a 1 (RECEBIMENTO) */
  fracao: number;
}

/** O ALVO liberado da comissão agora: o quanto do valor já é devido pelo gatilho congelado nela. */
export function alvoLiberado(c: { valor: number; quando: Quando }, e: EstadoDaVenda): number {
  const viva = (VENDA_VIVA as readonly string[]).includes(e.statusOrcamento);
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
}).strict().superRefine((r, ctx) => {
  const erro = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (!(PAPEIS_ATIVOS as readonly string[]).includes(r.papel)) erro("papel", "Por enquanto só o papel Vendedor gera comissão.");
  if (r.quemTipo === "PESSOA" && !r.usuarioId) erro("usuarioId", "Escolha a pessoa.");
  if (r.quemTipo === "CARGO" && !r.cargoId) erro("cargoId", "Escolha o cargo.");
  if (r.sobreTipo === "CATEGORIA" && !r.categoria) erro("categoria", "Informe a categoria de serviço.");
  if (r.sobreTipo === "SERVICO" && !r.servicoId) erro("servicoId", "Escolha o serviço.");
  if (r.base !== "FIXO_ITEM" && r.valor > PCT_MAX) erro("valor", "O percentual vai de 0 a 100.");
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
  };
}

export const configComissaoSchema = z.object({
  quando: z.enum(QUANDO),
  liquidaImpostos: z.boolean(),
}).strict();

export const MOTIVO_TROCA_MIN = 5;
export const trocarVendedorSchema = z.object({
  vendedorId: z.string().trim().min(1, "Escolha o vendedor."),
  motivo: z.string({ required_error: "Informe o motivo da troca." }).trim().min(MOTIVO_TROCA_MIN, `Informe o motivo da troca (mínimo ${MOTIVO_TROCA_MIN} caracteres).`).max(300),
}).strict();
