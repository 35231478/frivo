/**
 * O SINO: o que cada pessoa recebe em /api/alertas — regra pura, a mesma no servidor e nos testes.
 *
 * Duas camadas:
 *  1. PERMISSÃO: cada grupo de aviso só vai para quem pode abrir o destino (como já era);
 *  2. ESCOPO DO TÉCNICO: no modo técnico (lib/tecnico/modo), o técnico só recebe o que é DELE — os
 *     aceites das OS em que tem atividade e a NF dos pedidos de compra que ele fez. Antes, por ter
 *     "OS › Visualizar" no perfil, ele recebia pela API contagens da EMPRESA INTEIRA: OS atrasadas de
 *     outros técnicos, chamados do portal, prazos, veículos. O app de campo não mostra o sino, mas a API
 *     respondia.
 *
 * E um aviso novo, só do escritório: NOTA BAIXA no aceite (até `NOTA_BAIXA_ACEITE` estrelas), com o
 * link para a OS — sai do sino quando alguém do escritório abre a OS (o mesmo "visto" do aceite).
 */
import { pode, type Permissoes } from "@/lib/permissoes";

/** Janela do aviso de saldo negativo por uso em campo: produtos com uso do app nestes dias */
export const DIAS_USO_CAMPO_SINO = 30;

/** Nota do aceite que vira alerta para o gestor: 1 ou 2 estrelas (não há configuração na empresa para isso). */
export const NOTA_BAIXA_ACEITE = 2;

export const ehNotaBaixa = (avaliacao: number | null | undefined) =>
  typeof avaliacao === "number" && avaliacao >= 1 && avaliacao <= NOTA_BAIXA_ACEITE;

export interface QuemPergunta {
  permissoes: Permissoes | null | undefined;
  role?: string;
  /** Modo técnico: só as atividades dele (lib/tecnico/escopo › escopoDaSessao) */
  restrito: boolean;
}

/** Os grupos de aviso que o sino calcula para esta pessoa (false = nem consulta). */
export interface EscopoDoSino {
  prazos: boolean; comprasPendentes: boolean; veiculos: boolean; boletos: boolean; orcamentos: boolean;
  fiscal: boolean; medicoes: boolean; reajustes: boolean; separacao: boolean; pmoc: boolean; admissoes: boolean;
  /** Aceites (confirmados e com ressalva): no modo técnico, só das OS dele */
  aceites: boolean;
  /** Nota baixa do aceite: só o escritório (quem gere a OS), nunca o técnico */
  notaBaixa: boolean;
  /** Despesas de campo esperando aprovação: quem lança contas a pagar (Financeiro › Fluxo de caixa) */
  despesasCampo: boolean;
  /** Comentário novo do campo na OS (conversa interna): só o escritório, para quem vê OS */
  comentariosCampo: boolean;
  /** Atividade esquecida em andamento (passou do limite da empresa, ou começou em outro dia): só o escritório */
  atividadesEsquecidas: boolean;
  /** Uso em campo deixou produto com saldo negativo (app do técnico): quem vê o Estoque, nunca o técnico */
  estoqueNegativoCampo: boolean;
  /** OS em aberto sem técnico (lib/os/sem-tecnico): quem vê OS; entra no número do sino */
  osSemTecnico: boolean;
  /** Orçamento enviado que vence até o prazo do aviso (lib/orcamentos/ciclo): quem vê orçamentos; entra no número */
  orcamentosVencendo: boolean;
  /** Contas a pagar que vencem hoje: quem abre a lista (Financeiro › Visualizar); só no painel, fora do número */
  contasPagarHoje: boolean;
  /** Contas a receber que vencem hoje: quem abre a lista (Financeiro › Contas a receber); só no painel */
  contasReceberHoje: boolean;
  /** OS esperando o pedido do cliente (lib/pedido-cliente): quem vê OS; o painel conta todas, o sino só as atrasadas */
  pedidosCliente: boolean;
  /** NF chegou num pedido que a própria pessoa fez: sempre (é dela) */
  nfDosMeusPedidos: true;
}

export function escopoDoSino({ permissoes, role, restrito }: QuemPergunta): EscopoDoSino {
  const p = (modulo: string, acao: Parameters<typeof pode>[2]) => pode(permissoes, modulo, acao, role);
  const daEmpresa = !restrito; // contagens da empresa inteira: nunca para o escopo do técnico
  const verOrdens = p("ordens", "visualizar");
  return {
    prazos: daEmpresa && verOrdens,
    comprasPendentes: daEmpresa && p("compras", "visualizar"),
    veiculos: daEmpresa && p("veiculos", "visualizar"),
    boletos: daEmpresa && p("financeiro", "contasReceber"),
    orcamentos: daEmpresa && p("orcamentos", "visualizar"),
    fiscal: daEmpresa && p("financeiro", "fiscal"),
    medicoes: daEmpresa && p("financeiro", "medicoes"),
    reajustes: daEmpresa && p("contratos", "editar"),
    separacao: daEmpresa && p("estoque", "separar"),
    pmoc: daEmpresa && p("pmoc", "visualizar"),
    admissoes: daEmpresa && p("admissao", "gerenciar"),
    aceites: verOrdens,
    notaBaixa: daEmpresa && verOrdens,
    estoqueNegativoCampo: daEmpresa && p("estoque", "visualizar"),
    atividadesEsquecidas: daEmpresa && verOrdens,
    comentariosCampo: daEmpresa && verOrdens,
    despesasCampo: daEmpresa && p("financeiro", "fluxoCaixa"),
    osSemTecnico: daEmpresa && verOrdens,
    orcamentosVencendo: daEmpresa && p("orcamentos", "visualizar"),
    contasPagarHoje: daEmpresa && p("financeiro", "visualizar"),
    contasReceberHoje: daEmpresa && p("financeiro", "contasReceber"),
    pedidosCliente: daEmpresa && verOrdens,
    nfDosMeusPedidos: true,
  };
}
