import { NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DIAS_USO_CAMPO_SINO, escopoDoSino } from "@/lib/alertas/sino";
import { contarAtividadesEsquecidas } from "@/lib/execucao/andamento-server";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";
import { hojeDiaCivil } from "@/lib/fuso";
import { avisosNfse, reconciliarEmpresa } from "@/lib/nfse/webhook-server";
import { contarAtencaoFaturamento } from "@/lib/faturamento/painel-contratos-server";
import { contarReajustesPendentes } from "@/lib/contratos/reajuste-server";
import { contarFilaSeparacao } from "@/lib/estoque/separacao-server";
import { contarFilaDevolucao } from "@/lib/estoque/devolucao-server";
import { contarAvisosPmoc, registrarAvisosPmoc } from "@/lib/pmoc-avisos-server";
import { SEM_AVISOS_DE_ACEITE, avisosDeAceite } from "@/lib/os/aceite-server";
import { contarAdmissoesAssinadas } from "@/lib/admissao/admissao-server";
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";
import { empresaTemModulo } from "@/lib/modulos/catalogo";
import { modulosDesligados } from "@/lib/modulos/servidor";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { permissoes, role } = session.user!;

  // O sino só conta o que o usuário PODE ver (permissão) e o que é DELE (escopo do técnico): a regra pura
  // está em lib/alertas/sino › escopoDoSino. No modo técnico, nada da empresa inteira — só os aceites das OS
  // em que ele tem atividade e a NF dos pedidos que ele fez.
  const escopoTecnico = escopoDaSessao(session);
  const e = escopoDoSino({ permissoes, role, restrito: escopoTecnico.restrito });
  const verOrdens = e.prazos, verCompras = e.comprasPendentes, verVeiculos = e.veiculos, verBoletos = e.boletos;
  const verOrcamentos = e.orcamentos, verFiscal = e.fiscal, verMedicoes = e.medicoes, editarContratos = e.reajustes;
  const separaMaterial = e.separacao, verPmoc = e.pmoc, verAdmissoes = e.admissoes;

  // MÓDULOS DA EMPRESA (Loja de Módulos): o sino é tela do núcleo, mas conta coisa de módulo.
  // O que é de um módulo desligado não vira aviso — some do sino como sumiu do menu. Não é 403:
  // o sino segue respondendo com todo o resto (degradação graciosa, lib/modulos).
  const desligados = await modulosDesligados(empresaId);
  const temFrota = empresaTemModulo(desligados, "veiculos");
  const temEstoque = empresaTemModulo(desligados, "estoque");

  // NFS-e paradas sem aviso do PlugNotas: o sino (2 em 2 min) puxa a reconciliação da empresa
  // DEPOIS de responder (no máximo 1 rodada por minuto por empresa; não atrasa o sino)
  after(() => reconciliarEmpresa(empresaId).catch((e) => console.error("[nfse] reconciliação", (e as Error)?.name)));

  // PMOC: o aviso de vencimento é calculado pela data; aqui ele é REGISTRADO no histórico do plano,
  // uma vez por plano e data de expiração (idempotente), depois de responder
  if (verPmoc) after(() => registrarAvisosPmoc(empresaId).catch((e) => console.error("[pmoc] avisos", (e as Error)?.name)));

  const inicioHoje = hojeDiaCivil(); // recebimento é dia civil: hoje em Brasília

  const zeroVeiculos = { checklistPendente: 0, checklistsComAlertas: 0, checklistNaoVaiUsar: 0, documentosVencendo: 0, veiculosManutencao: 0, revisaoChegando: 0 };
  const zeroNfse = { nfseAutorizadas: 0, nfseAutorizadaMedicaoId: null, nfseRejeitadas: 0, nfseRejeitadaMedicaoId: null, nfseAguardando: 0, nfseAguardandoMedicaoId: null };
  const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [prazosBrutos, veiculosBrutos, boletosPagos, orcamentosRespondidos, leadsSite, nfsDoPedido, nfse, faturamentoContratos, reajustesContrato, separacoesPendentes, devolucoesPendentes, pmoc, aceites, admissoes, estoqueNegativoCampo, esquecidas] = await Promise.all([
    verOrdens || verCompras ? contarAlertasPrazos(empresaId) : Promise.resolve(null),
    verVeiculos && temFrota ? contarAlertasVeiculos(empresaId) : Promise.resolve(null),
    verBoletos
      ? prisma.contaReceber.count({ where: { empresaId, boletoStatus: "PAGO", dataRecebimento: { gte: inicioHoje } } })
      : Promise.resolve(0),
    // Cliente aprovou/recusou pelo link e ninguém abriu o orçamento ainda (lib/orcamentos/ciclo)
    verOrcamentos
      ? prisma.orcamento.count({ where: { empresaId, status: { in: ["APROVADO", "REPROVADO"] }, respostaVistaEm: null } })
      : Promise.resolve(0),
    // Novos leads do site (calculadora de BTU) nas últimas 24h — o sino não deixa o lead passar
    // despercebido (destino: /leads-site). Mesma permissão de ver orçamentos.
    verOrcamentos
      ? prisma.orcamento.count({ where: { empresaId, nome: { startsWith: "Lead do site" }, criadoEm: { gte: desde24h } } })
      : Promise.resolve(0),
    // Chegou NF num pedido de compra que ESTE usuário pediu e ele ainda não abriu (Compras 2/2).
    // Não depende de permissão: quem pediu sempre vê o próprio pedido (lib/compras/pedido podeVerPedido).
    prisma.pedidoCompraInterno.findMany({
      where: { empresaId, solicitanteId: session.user!.id, nfVinculadaEm: { not: null }, nfVistaEm: null },
      select: { id: true }, orderBy: { nfVinculadaEm: "desc" }, take: 50,
    }),
    // NFS-e: autorizada/rejeitada que ninguém viu e nota parada há 30 min (Financeiro › Fiscal)
    verFiscal ? avisosNfse(empresaId) : Promise.resolve(zeroNfse),
    // D7: faturamento automático de contrato que falhou 3× ou parou numa pendência (Financeiro › Medições)
    verMedicoes ? contarAtencaoFaturamento(empresaId) : Promise.resolve(0),
    // PR4 (D8): contrato fez aniversário e o reajuste espera alguém aplicar/adiar/dispensar (Contratos › Editar)
    editarContratos ? contarReajustesPendentes(empresaId) : Promise.resolve(0),
    // E4.1: OS viva com material ainda não separado (fila "A separar") — só para quem tem Estoque › Separar material
    separaMaterial && temEstoque ? contarFilaSeparacao(empresaId) : Promise.resolve(0),
    // E4.3: OS com sobra separada a devolver (ou cancelada com material reservado) — mesma permissão
    separaMaterial && temEstoque ? contarFilaDevolucao(empresaId) : Promise.resolve(0),
    // PMOC perto de expirar (antecedência da empresa) e expirado, menos os que já tiveram ciência (PMOC › Visualizar)
    verPmoc ? contarAvisosPmoc(empresaId) : Promise.resolve({ pmocsVencendo: 0, pmocsExpirados: 0 }),
    // Aceite do cliente: confirmou pelo link (ou assinou com o técnico) e ninguém do escritório abriu a OS
    // ainda — as ressalvas à parte. Só para quem vê OS; o técnico, só das OS em que tem atividade
    // A nota baixa (até 2 estrelas) vira aviso próprio do escritório, com o link para a OS (lib/alertas/sino)
    e.aceites ? avisosDeAceite(empresaId, filtroEscopo(escopoTecnico), { separarNotaBaixa: e.notaBaixa }) : Promise.resolve(SEM_AVISOS_DE_ACEITE),
    // Admissão assinada esperando ir para o contador (Equipe › Admissões)
    verAdmissoes ? contarAdmissoesAssinadas(empresaId) : Promise.resolve({ admissoesAssinadas: 0, admissaoAssinadaId: null }),
    // App do técnico: material usado em campo deixou o produto com saldo negativo (o técnico não trava; o escritório confere)
    e.estoqueNegativoCampo && temEstoque
      ? prisma.produto.count({ where: { empresaId, ativo: true, controlaEstoque: true, saldo: { lt: 0 }, materiaisCampo: { some: { removidoEm: null, criadoEm: { gte: new Date(Date.now() - DIAS_USO_CAMPO_SINO * 86_400_000) } } } } })
      : Promise.resolve(0),
    // App do técnico: atividade esquecida em andamento (passou do limite da empresa ou começou em outro dia)
    e.atividadesEsquecidas ? contarAtividadesEsquecidas(empresaId) : Promise.resolve({ atividadesEsquecidas: 0, atividadeEsquecidaOsId: null }),
  ]);

  const prazos = {
    prazosVencidos: verOrdens ? prazosBrutos?.prazosVencidos ?? 0 : 0,
    etapasVencendoHoje: verOrdens ? prazosBrutos?.etapasVencendoHoje ?? 0 : 0,
    atendimentosAtraso: verOrdens ? prazosBrutos?.atendimentosAtraso ?? 0 : 0,
    chamadosPortal: verOrdens ? prazosBrutos?.chamadosPortal ?? 0 : 0,
    atendimentoVencendo: verOrdens ? prazosBrutos?.atendimentoVencendo ?? 0 : 0,
    atendimentoEstourado: verOrdens ? prazosBrutos?.atendimentoEstourado ?? 0 : 0,
    pedidosPendentes: verCompras ? prazosBrutos?.pedidosPendentes ?? 0 : 0,
  };
  const veiculos = veiculosBrutos ?? zeroVeiculos;

  const totalPrazos = prazos.prazosVencidos + prazos.etapasVencendoHoje + prazos.atendimentosAtraso + prazos.chamadosPortal + prazos.pedidosPendentes
    + prazos.atendimentoVencendo + prazos.atendimentoEstourado;
  const totalVeiculos = veiculos.checklistPendente + veiculos.checklistsComAlertas + veiculos.checklistNaoVaiUsar + veiculos.documentosVencendo + veiculos.veiculosManutencao;

  return NextResponse.json({
    ...prazos,
    ...veiculos,
    boletosPagos,
    orcamentosRespondidos,
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
    total: totalPrazos + totalVeiculos + boletosPagos + orcamentosRespondidos + leadsSite + nfsDoPedido.length + nfse.nfseAutorizadas + nfse.nfseRejeitadas + nfse.nfseAguardando + faturamentoContratos + reajustesContrato + separacoesPendentes + devolucoesPendentes + pmoc.pmocsVencendo + pmoc.pmocsExpirados + aceites.aceitesRessalva + aceites.aceitesConfirmados + aceites.avaliacoesBaixas + admissoes.admissoesAssinadas + estoqueNegativoCampo + esquecidas.atividadesEsquecidas,
  });
}
