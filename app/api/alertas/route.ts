import { NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
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
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { permissoes, role } = session.user!;

  // O sino só conta o que o usuário PODE ver: técnico/auxiliar não recebe
  // "Compras pendentes" nem "Boletos pagos" (T1).
  const verOrdens = pode(permissoes, "ordens", "visualizar", role);
  const verCompras = pode(permissoes, "compras", "visualizar", role);
  const verVeiculos = pode(permissoes, "veiculos", "visualizar", role);
  const verBoletos = pode(permissoes, "financeiro", "contasReceber", role);
  const verOrcamentos = pode(permissoes, "orcamentos", "visualizar", role);
  const verFiscal = pode(permissoes, "financeiro", "fiscal", role);
  const verMedicoes = pode(permissoes, "financeiro", "medicoes", role);
  const editarContratos = pode(permissoes, "contratos", "editar", role);
  const separaMaterial = pode(permissoes, "estoque", "separar", role);
  const verPmoc = pode(permissoes, "pmoc", "visualizar", role);

  // NFS-e paradas sem aviso do PlugNotas: o sino (2 em 2 min) puxa a reconciliação da empresa
  // DEPOIS de responder (no máximo 1 rodada por minuto por empresa; não atrasa o sino)
  after(() => reconciliarEmpresa(empresaId).catch((e) => console.error("[nfse] reconciliação", (e as Error)?.name)));

  // PMOC: o aviso de vencimento é calculado pela data; aqui ele é REGISTRADO no histórico do plano,
  // uma vez por plano e data de expiração (idempotente), depois de responder
  if (verPmoc) after(() => registrarAvisosPmoc(empresaId).catch((e) => console.error("[pmoc] avisos", (e as Error)?.name)));

  const inicioHoje = hojeDiaCivil(); // recebimento é dia civil: hoje em Brasília

  const zeroVeiculos = { checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, revisaoChegando: 0 };
  const zeroNfse = { nfseAutorizadas: 0, nfseAutorizadaMedicaoId: null, nfseRejeitadas: 0, nfseRejeitadaMedicaoId: null, nfseAguardando: 0, nfseAguardandoMedicaoId: null };
  const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [prazosBrutos, veiculosBrutos, boletosPagos, orcamentosRespondidos, leadsSite, nfsDoPedido, nfse, faturamentoContratos, reajustesContrato, separacoesPendentes, devolucoesPendentes, pmoc, aceites] = await Promise.all([
    verOrdens || verCompras ? contarAlertasPrazos(empresaId) : Promise.resolve(null),
    verVeiculos ? contarAlertasVeiculos(empresaId) : Promise.resolve(null),
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
    separaMaterial ? contarFilaSeparacao(empresaId) : Promise.resolve(0),
    // E4.3: OS com sobra separada a devolver (ou cancelada com material reservado) — mesma permissão
    separaMaterial ? contarFilaDevolucao(empresaId) : Promise.resolve(0),
    // PMOC perto de expirar (antecedência da empresa) e expirado, menos os que já tiveram ciência (PMOC › Visualizar)
    verPmoc ? contarAvisosPmoc(empresaId) : Promise.resolve({ pmocsVencendo: 0, pmocsExpirados: 0 }),
    // Aceite do cliente: confirmou pelo link (ou assinou com o técnico) e ninguém do escritório abriu a OS
    // ainda — as ressalvas à parte. Só para quem vê OS; o técnico, só das OS em que tem atividade
    verOrdens ? avisosDeAceite(empresaId, filtroEscopo(escopoDaSessao(session))) : Promise.resolve(SEM_AVISOS_DE_ACEITE),
  ]);

  const prazos = {
    prazosVencidos: verOrdens ? prazosBrutos?.prazosVencidos ?? 0 : 0,
    etapasVencendoHoje: verOrdens ? prazosBrutos?.etapasVencendoHoje ?? 0 : 0,
    atendimentosAtraso: verOrdens ? prazosBrutos?.atendimentosAtraso ?? 0 : 0,
    chamadosPortal: verOrdens ? prazosBrutos?.chamadosPortal ?? 0 : 0,
    pedidosPendentes: verCompras ? prazosBrutos?.pedidosPendentes ?? 0 : 0,
  };
  const veiculos = veiculosBrutos ?? zeroVeiculos;

  const totalPrazos = prazos.prazosVencidos + prazos.etapasVencendoHoje + prazos.atendimentosAtraso + prazos.chamadosPortal + prazos.pedidosPendentes;
  const totalVeiculos = veiculos.checklistPendente + veiculos.checklistsComAlertas + veiculos.documentosVencendo + veiculos.veiculosManutencao;

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
    total: totalPrazos + totalVeiculos + boletosPagos + orcamentosRespondidos + leadsSite + nfsDoPedido.length + nfse.nfseAutorizadas + nfse.nfseRejeitadas + nfse.nfseAguardando + faturamentoContratos + reajustesContrato + separacoesPendentes + devolucoesPendentes + pmoc.pmocsVencendo + pmoc.pmocsExpirados + aceites.aceitesRessalva + aceites.aceitesConfirmados,
  });
}
