/**
 * PAINEL DE PENDÊNCIAS — o catálogo puro (servidor, tela e testes).
 *
 * O que precisa de ação hoje, por área. Não há contagem nem regra aqui: os números vêm de `contarSino`
 * (lib/alertas/sino-server), os mesmos do sino; quem pode ver cada item é o escopo do sino
 * (lib/alertas/sino › escopoDoSino). Este arquivo só diz, para cada item, o rótulo, o tom, o ícone e o
 * destino do toque — e o sino lê daqui o rótulo e o destino dos mesmos itens, para não haver dois.
 *
 * O toque leva para onde o item se resolve: com um registro só (e o id dele), abre o registro; com vários,
 * a lista já filtrada. As contas do dia não entram no número do sino (são rotina de todo dia).
 */
import type { EscopoDoSino } from "@/lib/alertas/sino";
import { ehAvisoDoNumero, type AvisoDoNumero } from "@/lib/alertas/lidos";
import { FILTRO_SEM_TECNICO } from "@/lib/os/sem-tecnico";
import { FILTRO_AGUARDANDO_PEDIDO, FILTRO_CONFERIR_PEDIDO } from "@/lib/pedido-cliente/where";
import { reais } from "@/lib/pedido-cliente/regra";
import { FILTRO_VENCENDO } from "@/lib/orcamentos/ciclo";

export type TomPendencia = "atrasado" | "atencao" | "acento";
export type AreaPendencia = "operacao" | "comercial" | "financeiro" | "estoque";
/** A chave do ícone (a tela traduz para o componente: components/alertas/icones-pendencia) */
export type IconePendencia = "semTecnico" | "atrasada" | "esquecida" | "comentario" | "pmoc" | "orcamento" | "despesa" | "pagar" | "receber" | "estoque" | "pedidoCliente";

/** Os números que o catálogo usa (o retorno de contarSino tem todos) */
export interface DadosPendencias {
  osSemTecnico: number; osSemTecnicoId: string | null;
  atendimentosAtraso: number;
  atividadesEsquecidas: number; atividadeEsquecidaOsId: string | null;
  comentariosCampo: number; comentarioCampoOsId: string | null;
  pmocsVencendo: number;
  orcamentosVencendo: number; orcamentoVencendoId: string | null;
  despesasCampo: number;
  estoqueNegativoCampo: number;
  /** PC-2: pedidos de compra do portal esperando a conferência */
  pedidosConferir?: number; pedidoConferirOsId?: string | null;
  foraDoNumero?: { contasPagarHoje: number; contasReceberHoje: number; pedidosAguardando?: number; pedidosAguardandoTotal?: number };
}

export interface ItemPendencia {
  id: IdPendencia;
  rotulo: string;
  valor: number;
  href: string;
  tom: TomPendencia;
  icone: IconePendencia;
  /** Ao lado do número (ex.: o total em R$ parado) */
  detalhe?: string | null;
}

export const ROTULO_AREA: Record<AreaPendencia, string> = {
  operacao: "Operação", comercial: "Comercial", financeiro: "Financeiro", estoque: "Estoque",
};

const hrefOs = (id: string | null) => (id ? `/ordens/${id}` : "/ordens");
/** Um registro só e o id dele: abre o registro; senão, a lista filtrada */
const umOuLista = (valor: number, id: string | null, registro: (id: string) => string, lista: string) =>
  valor === 1 && id ? registro(id) : lista;

/** A URL das contas que vencem hoje (o cartão "Vence hoje" com o período "Hoje"; o mesmo de SP_CONTAS_HOJE) */
export const CONTAS_HOJE = "card=VENCE_HOJE&periodo=hoje";

interface DefPendencia {
  area: AreaPendencia;
  rotulo: string;
  tom: TomPendencia;
  icone: IconePendencia;
  /** O grupo do escopo do sino que libera o item (permissão + nunca o técnico no modo técnico) */
  escopo: keyof EscopoDoSino;
  valor: (d: DadosPendencias) => number;
  href: (d: DadosPendencias) => string;
  detalhe?: (d: DadosPendencias) => string | null;
}

/** Os itens, na ordem do painel. */
export const PENDENCIAS = {
  osSemTecnico: {
    area: "operacao", rotulo: "OS sem técnico", tom: "atencao", icone: "semTecnico", escopo: "osSemTecnico",
    valor: (d) => d.osSemTecnico,
    href: (d) => umOuLista(d.osSemTecnico, d.osSemTecnicoId, (id) => `/ordens/${id}`, `/ordens?tecnico=${FILTRO_SEM_TECNICO}&periodo=todos`),
  },
  osAtrasadas: {
    area: "operacao", rotulo: "OS atrasadas", tom: "atrasado", icone: "atrasada", escopo: "prazos",
    valor: (d) => d.atendimentosAtraso, href: () => "/ordens?prazo=atrasadas&periodo=todos",
  },
  atividadesEsquecidas: {
    area: "operacao", rotulo: "Atividades esquecidas em andamento", tom: "atencao", icone: "esquecida", escopo: "atividadesEsquecidas",
    valor: (d) => d.atividadesEsquecidas, href: (d) => hrefOs(d.atividadeEsquecidaOsId),
  },
  comentariosCampo: {
    area: "operacao", rotulo: "Comentários novos do campo", tom: "acento", icone: "comentario", escopo: "comentariosCampo",
    valor: (d) => d.comentariosCampo, href: (d) => `${hrefOs(d.comentarioCampoOsId)}#comentarios`,
  },
  pmocsVencendo: {
    area: "operacao", rotulo: "PMOC perto de expirar", tom: "atencao", icone: "pmoc", escopo: "pmoc",
    valor: (d) => d.pmocsVencendo, href: () => "/pmoc?status=VENCENDO",
  },
  orcamentosVencendo: {
    area: "comercial", rotulo: "Orçamentos vencendo", tom: "atencao", icone: "orcamento", escopo: "orcamentosVencendo",
    valor: (d) => d.orcamentosVencendo,
    href: (d) => umOuLista(d.orcamentosVencendo, d.orcamentoVencendoId, (id) => `/orcamentos/${id}`, `/orcamentos?validade=${FILTRO_VENCENDO}&periodo=todos`),
  },
  pedidosCliente: {
    area: "financeiro", rotulo: "Aguardando pedido do cliente", tom: "atencao", icone: "pedidoCliente", escopo: "pedidosCliente",
    valor: (d) => d.foraDoNumero?.pedidosAguardando ?? 0,
    // a lista de OS só com as que esperam, as mais antigas primeiro
    href: () => `/ordens?pedido=${FILTRO_AGUARDANDO_PEDIDO}&periodo=todos&sort=criadoEm&dir=asc`,
    detalhe: (d) => (d.foraDoNumero?.pedidosAguardandoTotal ? reais(d.foraDoNumero.pedidosAguardandoTotal) : null),
  },
  pedidosConferir: {
    area: "financeiro", rotulo: "Pedidos do cliente para conferir", tom: "acento", icone: "pedidoCliente", escopo: "pedidosCliente",
    valor: (d) => d.pedidosConferir ?? 0,
    // um pedido: a OS dele (a etiqueta abre a conferência); mais: a lista de OS em conferência
    href: (d) => (d.pedidoConferirOsId ? `/ordens/${d.pedidoConferirOsId}` : `/ordens?pedido=${FILTRO_CONFERIR_PEDIDO}&periodo=todos`),
  },
  despesasCampo: {
    area: "financeiro", rotulo: "Despesas de campo a aprovar", tom: "atencao", icone: "despesa", escopo: "despesasCampo",
    valor: (d) => d.despesasCampo, href: () => "/financeiro/despesas-campo",
  },
  contasPagarHoje: {
    area: "financeiro", rotulo: "Contas a pagar vencendo hoje", tom: "acento", icone: "pagar", escopo: "contasPagarHoje",
    valor: (d) => d.foraDoNumero?.contasPagarHoje ?? 0, href: () => `/financeiro/contas-pagar?${CONTAS_HOJE}`,
  },
  contasReceberHoje: {
    area: "financeiro", rotulo: "Contas a receber vencendo hoje", tom: "acento", icone: "receber", escopo: "contasReceberHoje",
    valor: (d) => d.foraDoNumero?.contasReceberHoje ?? 0, href: () => `/financeiro/contas-receber?${CONTAS_HOJE}`,
  },
  estoqueNegativoCampo: {
    area: "estoque", rotulo: "Saldo negativo por uso em campo", tom: "atrasado", icone: "estoque", escopo: "estoqueNegativoCampo",
    valor: (d) => d.estoqueNegativoCampo, href: () => "/estoque?situacao=negativo",
  },
} satisfies Record<string, DefPendencia>;

export type IdPendencia = keyof typeof PENDENCIAS;

/** O grupo do escopo do sino que libera o item (a tela usa como segunda trava, pela mesma regra do servidor) */
export const escopoDoItem = (id: IdPendencia): keyof EscopoDoSino => (PENDENCIAS[id] as DefPendencia).escopo;

/** Um item com o número e o destino de agora (o sino usa para os itens que ele também mostra) */
export function itemPendencia(id: IdPendencia, d: DadosPendencias): ItemPendencia {
  const def: DefPendencia = PENDENCIAS[id];
  // Campo que não veio (resposta de uma versão anterior, no meio de um deploy) conta como zero
  return { id, rotulo: def.rotulo, valor: Number(def.valor(d)) || 0, href: def.href(d), tom: def.tom, icone: def.icone, detalhe: def.detalhe?.(d) ?? null };
}

/** O aviso do número do sino que o item é (a marca de lido, lib/alertas/lidos); as contas do dia não estão no número */
export const avisoDoItem = (id: IdPendencia): AvisoDoNumero | null => (id === "osAtrasadas" ? "atendimentosAtraso" : ehAvisoDoNumero(id) ? id : null);

export interface AreaComPendencias { area: AreaPendencia; rotulo: string; itens: ItemPendencia[] }

/**
 * O painel: as áreas com o que esta pessoa pode ver (escopo do sino) e tem pendente (número > 0), na ordem
 * do catálogo. Área sem nada pendente não aparece; nada pendente = lista vazia.
 */
export function painelDePendencias(d: DadosPendencias, escopo: EscopoDoSino): AreaComPendencias[] {
  const porArea = new Map<AreaPendencia, ItemPendencia[]>();
  for (const id of Object.keys(PENDENCIAS) as IdPendencia[]) {
    const def: DefPendencia = PENDENCIAS[id];
    if (!escopo[def.escopo]) continue;
    const item = itemPendencia(id, d);
    if (item.valor <= 0) continue;
    porArea.set(def.area, [...(porArea.get(def.area) ?? []), item]);
  }
  return (Object.keys(ROTULO_AREA) as AreaPendencia[])
    .filter((a) => porArea.has(a))
    .map((a) => ({ area: a, rotulo: ROTULO_AREA[a], itens: porArea.get(a)! }));
}

/** Quantas pendências ao todo (o resumo do topo do painel) */
export const totalDoPainel = (areas: AreaComPendencias[]) => areas.reduce((s, a) => s + a.itens.reduce((t, i) => t + i.valor, 0), 0);
