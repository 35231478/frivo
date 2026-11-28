/**
 * PEDIDO DO CLIENTE — a regra pura (servidor, telas e testes). Não confundir com o "Pedido de compra" do
 * fornecedor (módulo Compras): aqui é o pedido que o CLIENTE emite para nos pagar.
 *
 * Clientes corporativos só pagam com o pedido deles. A empresa orça e executa antes, conclui e fica esperando
 * o pedido para faturar, e os pendentes se perdiam. Agora:
 *  - a ficha do cliente (e, se precisar, a unidade) diz se o pedido é exigido: Não | Para faturar | Para
 *    executar e faturar;
 *  - o orçamento aprovado e a OS desse cliente nascem "Aguardando pedido" até alguém informar o pedido (um
 *    pedido pode cobrir várias OS e orçamentos) ou liberar sem pedido (permissão própria, com motivo);
 *  - sem pedido não se fatura nem se emite NFS-e; no modo "para executar", também não se inicia a execução;
 *  - o número do pedido entra sozinho na discriminação da NFS-e.
 *
 * O "Para faturar" é o antigo "Exige pedido de compra antes da NF" (cliente.exigePcAntesNf): quem já estava
 * marcado continua valendo, sem SQL de atualização. "Para executar" é o campo novo (exigePedidoExecutar).
 */

export const MODOS_PEDIDO = ["NAO", "FATURAR", "EXECUTAR"] as const;
export type ModoPedido = (typeof MODOS_PEDIDO)[number];

export const ROTULO_MODO_PEDIDO: Record<ModoPedido, string> = {
  NAO: "Não",
  FATURAR: "Para faturar",
  EXECUTAR: "Para executar e faturar",
};
/** O porquê de cada modo (vai para o tooltip, não para a tela) */
export const DICA_MODO_PEDIDO: Record<ModoPedido, string> = {
  NAO: "O cliente não exige o pedido dele para pagar.",
  FATURAR: "A OS é executada normalmente; a fatura e a NFS-e só saem depois de informado o pedido do cliente.",
  EXECUTAR: "Nem a execução começa sem o pedido do cliente: o técnico não consegue iniciar a atividade. A fatura e a NFS-e também esperam o pedido.",
};

export const ETIQUETA_AGUARDANDO = "Aguardando pedido";
export const DICA_FILTRO_AGUARDANDO = "OS e orçamentos de clientes que exigem o pedido deles e ainda não o enviaram. A fatura e a NFS-e esperam o pedido; o total é o valor que está parado.";
/** Na unidade: "Como o cliente" (null) ou um dos modos */
export const ROTULO_HERDA = "Como o cliente";

export const ehModoPedido = (v: unknown): v is ModoPedido => typeof v === "string" && (MODOS_PEDIDO as readonly string[]).includes(v);

/** O modo do CLIENTE pelos dois campos dele (o executar só vale junto com o faturar) */
export function modoDoCliente(c: { exigePcAntesNf?: boolean | null; exigePedidoExecutar?: boolean | null } | null | undefined): ModoPedido {
  if (!c?.exigePcAntesNf) return "NAO";
  return c.exigePedidoExecutar ? "EXECUTAR" : "FATURAR";
}

/** Os dois campos do cliente para um modo escolhido na ficha */
export const camposDoModo = (modo: ModoPedido) => ({ exigePcAntesNf: modo !== "NAO", exigePedidoExecutar: modo === "EXECUTAR" });

/** O modo que vale: o da unidade, quando ela tem um; senão, o do cliente */
export function modoEfetivo(
  cliente: { exigePcAntesNf?: boolean | null; exigePedidoExecutar?: boolean | null } | null | undefined,
  unidade?: { exigePedido?: string | null } | null,
): ModoPedido {
  return ehModoPedido(unidade?.exigePedido) ? unidade!.exigePedido as ModoPedido : modoDoCliente(cliente);
}

/** O que a regra precisa saber de uma OS ou orçamento */
export interface SituacaoPedido {
  modo: ModoPedido;
  /** Já tem pedido do cliente */
  pedidoId: string | null;
  /** Liberado sem pedido (quem tem a permissão, com motivo) */
  liberado: boolean;
  /** Cancelado (OS) ou recusado/cancelado (orçamento): não espera nada */
  encerradoSemCobranca: boolean;
  /** Já foi faturado (NF emitida, ou o PC registrado na fatura pelo jeito antigo) */
  faturado: boolean;
}

/** Está esperando o pedido do cliente? É a etiqueta "Aguardando pedido". */
export const aguardandoPedido = (s: SituacaoPedido) =>
  s.modo !== "NAO" && !s.pedidoId && !s.liberado && !s.encerradoSemCobranca && !s.faturado;

export const MSG_TRAVA_FATURAR = "Aguardando o pedido do cliente: informe o pedido (ou libere sem pedido, com o motivo) antes de faturar.";
export const MSG_TRAVA_NFSE = "Aguardando o pedido do cliente: informe o pedido das OS desta fatura (ou libere sem pedido, com o motivo) antes de emitir a NFS-e.";
export const MSG_TRAVA_INICIAR = "Aguardando o pedido do cliente: este cliente exige o pedido antes da execução. O escritório precisa informar o pedido (ou liberar) antes de iniciar.";

/** Trava da fatura e da NFS-e: algum item ainda aguarda o pedido */
export const travaFaturar = (itens: SituacaoPedido[]) => (itens.some(aguardandoPedido) ? MSG_TRAVA_FATURAR : null);

/** Trava do início da execução: só no modo "para executar e faturar" */
export const travaIniciar = (s: SituacaoPedido) => (s.modo === "EXECUTAR" && aguardandoPedido(s) ? MSG_TRAVA_INICIAR : null);

/** Alerta (não trava) quando o valor do pedido é menor que o total das OS e orçamentos que ele cobre */
export function alertaValorPedido(valorPedido: number | null | undefined, totalLigado: number): string | null {
  if (valorPedido == null || !(valorPedido > 0) || !(totalLigado > 0)) return null;
  if (Math.round(valorPedido * 100) >= Math.round(totalLigado * 100)) return null;
  const brl = reais;
  return `O valor do pedido (${brl(valorPedido)}) é menor que o total das OS e orçamentos que ele cobre (${brl(totalLigado)}).`;
}

/** Valor em reais com espaço comum (o Intl usa um espaço que não quebra; fica igual na tela, no histórico e na nota) */
export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

/** O texto do pedido na discriminação da NFS-e (e na descrição da fatura) */
export function textoPedidoNaNota(numeros: (string | null | undefined)[]): string | null {
  const ns = [...new Set(numeros.map((n) => (n ?? "").trim()).filter(Boolean))];
  if (!ns.length) return null;
  return ns.length === 1 ? `Pedido do cliente nº ${ns[0]}` : `Pedidos do cliente nº ${ns.join(", ")}`;
}

/** Número do pedido: o que o cliente escreveu, sem espaços sobrando; 1 a 60 caracteres */
export function limparNumeroPedido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= 60 ? t : null;
}

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 300;
export const MSG_MOTIVO = `Escreva o motivo da liberação (de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres).`;
export function limparMotivo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= MOTIVO_MIN && t.length <= MOTIVO_MAX ? t : null;
}

/**
 * Desde quando o item aguarda, para o sino: no modo "para executar", desde a aprovação (o orçamento assinado,
 * ou a criação da OS); no "para faturar", desde a conclusão da OS (o orçamento sem OS conta da aprovação).
 * null = ainda não começou a contar (a OS de "para faturar" ainda não foi concluída).
 */
export function inicioDaEspera(s: { modo: ModoPedido; aprovadoEm?: Date | null; criadoEm?: Date | null; concluidoEm?: Date | null; ehOrcamento?: boolean }): Date | null {
  if (s.modo === "NAO") return null;
  if (s.modo === "EXECUTAR" || s.ehOrcamento) return s.aprovadoEm ?? s.criadoEm ?? null;
  return s.concluidoEm ?? null;
}

export const DIAS_ALERTA_PEDIDO_PADRAO = 7;

/** Dias inteiros esperando (por instantes; 1 dia = 24 h) */
export const diasEsperando = (inicio: Date | null, agora: Date) => (inicio ? Math.floor((agora.getTime() - inicio.getTime()) / 86_400_000) : 0);
