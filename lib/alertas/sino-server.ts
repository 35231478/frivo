/**
 * O SINO — contagem no servidor. Uma função só, `contarSino`, para o sino (/api/alertas) e para o painel
 * de pendências (/pendencias): os dois mostram o mesmo número, contado do mesmo jeito.
 *
 * O que cada pessoa recebe é a regra pura de lib/alertas/sino (permissão + escopo do técnico); aqui só se
 * conta o que o escopo liberou. Os grupos que não entram no número do sino (as contas do dia) vêm à parte,
 * em `foraDoNumero`, e só o painel os mostra.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { comEscopo, filtroOrcamentos, filtroOrdens, type QuemVe } from "@/lib/escopo/proprios";
import { DIAS_USO_CAMPO_SINO, type EscopoDoSino } from "@/lib/alertas/sino";
import { totalDoSino } from "@/lib/alertas/lidos";
import { contarAtividadesEsquecidas } from "@/lib/execucao/andamento-server";
import { contarComentariosNovos } from "@/lib/execucao/comentarios";
import { contarDespesasPendentes } from "@/lib/execucao/despesas";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";
import { hojeDiaCivil } from "@/lib/fuso";
import { avisosNfse } from "@/lib/nfse/webhook-server";
import { contarAtencaoFaturamento } from "@/lib/faturamento/painel-contratos-server";
import { contarReajustesPendentes } from "@/lib/contratos/reajuste-server";
import { contarFilaSeparacao } from "@/lib/estoque/separacao-server";
import { contarFilaDevolucao } from "@/lib/estoque/devolucao-server";
import { contarAvisosPmoc } from "@/lib/pmoc-avisos-server";
import { SEM_AVISOS_DE_ACEITE, avisosDeAceite } from "@/lib/os/aceite-server";
import { contarAdmissoesAssinadas } from "@/lib/admissao/admissao-server";
import { empresaTemModulo } from "@/lib/modulos/catalogo";
import { modulosDesligados } from "@/lib/modulos/servidor";
import { whereOsSemTecnico } from "@/lib/os/sem-tecnico";
import { FILTRO_VENCENDO } from "@/lib/orcamentos/ciclo";
import { diasOrcamentoVencendo } from "@/lib/orcamentos/ciclo-server";
import { whereListaPagar, whereListaReceber, whereOrcamentos } from "@/lib/listas/filtros";
import { lerPeriodo } from "@/lib/periodo";
import { contarPedidosAtrasados, resumoAguardandoEmpresa, usaPedidoCliente } from "@/lib/pedido-cliente/server";
import { contarPedidosConferir } from "@/lib/pedido-cliente/portal-server";

export interface EntradaSino {
  empresaId: string;
  usuarioId: string;
  escopo: EscopoDoSino;
  /** O filtro do escopo do técnico (lib/tecnico/escopo › filtroEscopo) para os aceites */
  filtroTecnico: Parameters<typeof avisosDeAceite>[1];
  /** COM-1: quem vê ("Ver só os próprios" em Orçamentos/OS): as contagens de orçamento e de OS ficam no escopo */
  quem?: QuemVe;
  agora?: Date;
}

/**
 * A URL das contas que vencem hoje: o cartão "Vence hoje" com o período "Hoje". O painel conta com a mesma
 * função da lista (whereListaPagar/whereListaReceber) e esta mesma URL, então o número bate com a lista.
 */
export const SP_CONTAS_HOJE = { card: "VENCE_HOJE", periodo: "hoje" } as const;

const SEM_NFSE = { nfseAutorizadas: 0, nfseAutorizadaMedicaoId: null, nfseRejeitadas: 0, nfseRejeitadaMedicaoId: null, nfseAguardando: 0, nfseAguardandoMedicaoId: null };
const SEM_VEICULOS = { checklistPendente: 0, checklistsComAlertas: 0, checklistNaoVaiUsar: 0, documentosVencendo: 0, veiculosManutencao: 0, revisaoChegando: 0 };

export async function contarSino({ empresaId, usuarioId, escopo: e, filtroTecnico, quem, agora = new Date() }: EntradaSino) {
  const eo = filtroOrdens(quem), ec = filtroOrcamentos(quem);
  // MÓDULOS DA EMPRESA (Loja de Módulos): o sino é tela do núcleo, mas conta coisa de módulo.
  // O que é de um módulo desligado não vira aviso — some do sino como sumiu do menu (degradação graciosa).
  const desligados = await modulosDesligados(empresaId);
  const temFrota = empresaTemModulo(desligados, "veiculos");
  const temEstoque = empresaTemModulo(desligados, "estoque");
  const temOrcamentos = empresaTemModulo(desligados, "orcamentos");
  const temFinanceiro = empresaTemModulo(desligados, "financeiro");

  const inicioHoje = hojeDiaCivil(agora); // recebimento é dia civil: hoje em Brasília
  const desde24h = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  const periodoHoje = lerPeriodo(SP_CONTAS_HOJE, agora, { permitirTodos: true });

  // Orçamentos vencendo: o prazo do aviso "vence em X dias" da empresa (o mesmo da lista ?validade=vencendo)
  const verVencendo = e.orcamentosVencendo && temOrcamentos;
  // O prazo do aviso vem junto com as outras contagens (antes era esperado sozinho, uma ida ao banco a mais em fila)
  const contarVencendo = async (): Promise<readonly [number, { id: string } | null]> => {
    const where = comEscopo(whereOrcamentos(empresaId, { validade: FILTRO_VENCENDO }, agora, await diasOrcamentoVencendo(empresaId)), ec);
    return Promise.all([prisma.orcamento.count({ where }), prisma.orcamento.findFirst({ where, orderBy: { validadeEm: "asc" }, select: { id: true } })]);
  };
  const whereSemTecnico = comEscopo({ empresaId, ...whereOsSemTecnico() } as Prisma.OrdemServicoWhereInput, eo);
  // Pedido do cliente: o painel conta as OS que esperam (e o R$); o sino, só as que passaram do prazo da empresa.
  // Empresa sem cliente que exige o pedido: nem consulta. COM-1: as contagens de OS respeitam o "Ver só os próprios"
  const contarPedidos = async () => (e.pedidosCliente && await usaPedidoCliente(empresaId)
    ? Promise.all([resumoAguardandoEmpresa(empresaId, eo), contarPedidosAtrasados(empresaId, agora, eo), contarPedidosConferir(empresaId)])
    : [{ quantidade: 0, total: 0 }, { pedidosAtrasados: 0, pedidoAtrasadoOsId: null, diasAlertaPedido: 0 }, { pedidosConferir: 0, pedidoConferirId: null, pedidoConferirOsId: null, pedidoConferirOrcamentoId: null }] as const);
  const whereRespondidos = comEscopo({ empresaId, status: { in: ["APROVADO" as const, "REPROVADO" as const] }, respostaVistaEm: null } as Prisma.OrcamentoWhereInput, ec);

  const [prazosBrutos, veiculosBrutos, boletosPagos, respondidos, leadsSite, nfsDoPedido, nfse, faturamentoContratos, reajustesContrato, separacoesPendentes, devolucoesPendentes, pmoc, aceites, admissoes, estoqueNegativoCampo, esquecidas, comentarios, despesasCampo, semTecnico, vencendo, contasPagarHoje, contasReceberHoje, pedidos] = await Promise.all([
    e.prazos || e.comprasPendentes ? contarAlertasPrazos(empresaId, eo) : Promise.resolve(null),
    e.veiculos && temFrota ? contarAlertasVeiculos(empresaId) : Promise.resolve(null),
    e.boletos
      ? prisma.contaReceber.count({ where: { empresaId, boletoStatus: "PAGO", dataRecebimento: { gte: inicioHoje } } })
      : Promise.resolve(0),
    // Cliente aprovou/recusou pelo link e ninguém abriu o orçamento ainda (lib/orcamentos/ciclo)
    // (o mais recente vai no link quando é um só: abrir o orçamento é o que dá a resposta por vista)
    e.orcamentos
      ? Promise.all([prisma.orcamento.count({ where: whereRespondidos }), prisma.orcamento.findFirst({ where: whereRespondidos, orderBy: { atualizadoEm: "desc" }, select: { id: true } })])
      : Promise.resolve([0, null] as const),
    // Novos leads do site (calculadora de BTU) nas últimas 24h — o sino não deixa o lead passar
    // despercebido (destino: /leads-site). Mesma permissão de ver orçamentos.
    e.orcamentos
      ? prisma.orcamento.count({ where: comEscopo({ empresaId, nome: { startsWith: "Lead do site" }, criadoEm: { gte: desde24h } } as Prisma.OrcamentoWhereInput, ec) })
      : Promise.resolve(0),
    // Chegou NF num pedido de compra que ESTE usuário pediu e ele ainda não abriu (Compras 2/2).
    // Não depende de permissão: quem pediu sempre vê o próprio pedido (lib/compras/pedido podeVerPedido).
    prisma.pedidoCompraInterno.findMany({
      where: { empresaId, solicitanteId: usuarioId, nfVinculadaEm: { not: null }, nfVistaEm: null },
      select: { id: true }, orderBy: { nfVinculadaEm: "desc" }, take: 50,
    }),
    // NFS-e: autorizada/rejeitada que ninguém viu e nota parada há 30 min (Financeiro › Fiscal)
    e.fiscal ? avisosNfse(empresaId) : Promise.resolve(SEM_NFSE),
    // D7: faturamento automático de contrato que falhou 3× ou parou numa pendência (Financeiro › Medições)
    e.medicoes ? contarAtencaoFaturamento(empresaId) : Promise.resolve(0),
    // PR4 (D8): contrato fez aniversário e o reajuste espera alguém aplicar/adiar/dispensar (Contratos › Editar)
    e.reajustes ? contarReajustesPendentes(empresaId) : Promise.resolve(0),
    // E4.1: OS viva com material ainda não separado (fila "A separar") — só para quem tem Estoque › Separar material
    e.separacao && temEstoque ? contarFilaSeparacao(empresaId) : Promise.resolve(0),
    // E4.3: OS com sobra separada a devolver (ou cancelada com material reservado) — mesma permissão
    e.separacao && temEstoque ? contarFilaDevolucao(empresaId) : Promise.resolve(0),
    // PMOC perto de expirar (antecedência da empresa) e expirado, menos os que já tiveram ciência (PMOC › Visualizar)
    e.pmoc ? contarAvisosPmoc(empresaId) : Promise.resolve({ pmocsVencendo: 0, pmocsExpirados: 0 }),
    // Aceite do cliente: confirmou pelo link (ou assinou com o técnico) e ninguém do escritório abriu a OS
    // ainda — as ressalvas à parte. Só para quem vê OS; o técnico, só das OS em que tem atividade
    // A nota baixa (até 2 estrelas) vira aviso próprio do escritório, com o link para a OS (lib/alertas/sino)
    e.aceites ? avisosDeAceite(empresaId, filtroTecnico, { separarNotaBaixa: e.notaBaixa }) : Promise.resolve(SEM_AVISOS_DE_ACEITE),
    // Admissão assinada esperando ir para o contador (Equipe › Admissões)
    e.admissoes ? contarAdmissoesAssinadas(empresaId) : Promise.resolve({ admissoesAssinadas: 0, admissaoAssinadaId: null }),
    // App do técnico: material usado em campo deixou o produto com saldo negativo (o técnico não trava; o escritório confere)
    e.estoqueNegativoCampo && temEstoque
      ? prisma.produto.count({ where: { empresaId, ativo: true, controlaEstoque: true, saldo: { lt: 0 }, materiaisCampo: { some: { removidoEm: null, criadoEm: { gte: new Date(agora.getTime() - DIAS_USO_CAMPO_SINO * 86_400_000) } } } } })
      : Promise.resolve(0),
    // App do técnico: atividade esquecida em andamento (passou do limite da empresa ou começou em outro dia)
    e.atividadesEsquecidas ? contarAtividadesEsquecidas(empresaId) : Promise.resolve({ atividadesEsquecidas: 0, atividadeEsquecidaOsId: null }),
    // App do técnico: comentário novo do campo numa OS que esta pessoa ainda não leu
    e.comentariosCampo ? contarComentariosNovos(empresaId, usuarioId) : Promise.resolve({ comentariosCampo: 0, comentarioCampoOsId: null }),
    // App do técnico: despesas de campo esperando aprovação
    e.despesasCampo ? contarDespesasPendentes(empresaId) : Promise.resolve(0),
    // OS em aberto sem técnico (lib/os/sem-tecnico): a mais antiga vai no link quando é uma só
    e.osSemTecnico
      ? Promise.all([prisma.ordemServico.count({ where: whereSemTecnico }), prisma.ordemServico.findFirst({ where: whereSemTecnico, orderBy: { criadoEm: "asc" }, select: { id: true } })])
      : Promise.resolve([0, null] as const),
    // Orçamentos enviados que vencem até o prazo do aviso: o que vence antes vai no link quando é um só
    verVencendo
      ? contarVencendo()
      : Promise.resolve([0, null] as const),
    // Contas do dia (só o painel): a mesma conta da lista com "Vence hoje" e período "Hoje"
    e.contasPagarHoje && temFinanceiro ? prisma.contaPagar.count({ where: whereListaPagar(empresaId, SP_CONTAS_HOJE, periodoHoje, agora) }) : Promise.resolve(0),
    e.contasReceberHoje && temFinanceiro ? prisma.contaReceber.count({ where: whereListaReceber(empresaId, SP_CONTAS_HOJE, periodoHoje, agora) }) : Promise.resolve(0),
    contarPedidos(),
  ]);
  const [pedidosAguardando, pedidosAtrasados, pedidosConferir] = pedidos;

  const verOrdens = e.prazos, verCompras = e.comprasPendentes;
  const prazos = {
    prazosVencidos: verOrdens ? prazosBrutos?.prazosVencidos ?? 0 : 0,
    etapasVencendoHoje: verOrdens ? prazosBrutos?.etapasVencendoHoje ?? 0 : 0,
    atendimentosAtraso: verOrdens ? prazosBrutos?.atendimentosAtraso ?? 0 : 0,
    chamadosPortal: verOrdens ? prazosBrutos?.chamadosPortal ?? 0 : 0,
    atendimentoVencendo: verOrdens ? prazosBrutos?.atendimentoVencendo ?? 0 : 0,
    atendimentoEstourado: verOrdens ? prazosBrutos?.atendimentoEstourado ?? 0 : 0,
    pedidosPendentes: verCompras ? prazosBrutos?.pedidosPendentes ?? 0 : 0,
  };
  const veiculos = veiculosBrutos ?? SEM_VEICULOS;
  const [osSemTecnico, osSemTecnicoMaisAntiga] = semTecnico;
  const [orcamentosVencendo, orcamentoVencendoPrimeiro] = vencendo;
  const [orcamentosRespondidos, orcamentoRespondidoMaisRecente] = respondidos;

  const contagem = {
    ...prazos,
    ...veiculos,
    boletosPagos,
    orcamentosRespondidos,
    orcamentoRespondidoId: orcamentoRespondidoMaisRecente?.id ?? null,
    leadsSite,
    nfPedidos: nfsDoPedido.length,
    nfPedidoId: nfsDoPedido[0]?.id ?? null,
    ...nfse,
    faturamentoContratos,
    reajustesContrato,
    separacoesPendentes,
    devolucoesPendentes,
    ...pmoc,
    ...aceites,
    ...admissoes,
    estoqueNegativoCampo,
    ...esquecidas,
    ...comentarios,
    despesasCampo,
    osSemTecnico,
    osSemTecnicoId: osSemTecnicoMaisAntiga?.id ?? null,
    orcamentosVencendo,
    orcamentoVencendoId: orcamentoVencendoPrimeiro?.id ?? null,
    // O sino: OS esperando o pedido do cliente há mais que os dias da empresa (Configurações › Orçamentos e propostas)
    pedidosAtrasados: pedidosAtrasados.pedidosAtrasados,
    pedidoAtrasadoOsId: pedidosAtrasados.pedidoAtrasadoOsId,
    diasAlertaPedido: pedidosAtrasados.diasAlertaPedido,
    // PC-2: pedidos de compra anexados pelo comprador no portal, esperando a conferência do escritório
    pedidosConferir: pedidosConferir.pedidosConferir,
    pedidoConferirId: pedidosConferir.pedidoConferirId,
    pedidoConferirOsId: pedidosConferir.pedidoConferirOsId,
    pedidoConferirOrcamentoId: pedidosConferir.pedidoConferirOrcamentoId,
  };
  // O total do sino (lidos ou não): os avisos de lib/alertas/lidos › AVISOS_DO_NUMERO; as contas do dia
  // ficam fora (são rotina de todo dia; o painel as mostra)
  return {
    ...contagem, total: totalDoSino(contagem),
    // Só o painel: as contas do dia e as OS que esperam o pedido do cliente (todas, com o R$ parado)
    foraDoNumero: { contasPagarHoje, contasReceberHoje, pedidosAguardando: pedidosAguardando.quantidade, pedidosAguardandoTotal: pedidosAguardando.total },
  };
}

export type ContagemSino = Awaited<ReturnType<typeof contarSino>>;
