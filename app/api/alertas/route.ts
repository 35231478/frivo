import { NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";
import { hojeDiaCivil } from "@/lib/fuso";
import { avisosNfse, reconciliarEmpresa } from "@/lib/nfse/webhook-server";
import { contarAtencaoFaturamento } from "@/lib/faturamento/painel-contratos-server";

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

  // NFS-e paradas sem aviso do PlugNotas: o sino (2 em 2 min) puxa a reconciliação da empresa
  // DEPOIS de responder (no máximo 1 rodada por minuto por empresa; não atrasa o sino)
  after(() => reconciliarEmpresa(empresaId).catch((e) => console.error("[nfse] reconciliação", (e as Error)?.name)));

  const inicioHoje = hojeDiaCivil(); // recebimento é dia civil: hoje em Brasília

  const zeroVeiculos = { checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, revisaoChegando: 0 };
  const zeroNfse = { nfseAutorizadas: 0, nfseAutorizadaMedicaoId: null, nfseRejeitadas: 0, nfseRejeitadaMedicaoId: null, nfseAguardando: 0, nfseAguardandoMedicaoId: null };
  const [prazosBrutos, veiculosBrutos, boletosPagos, orcamentosRespondidos, nfsDoPedido, nfse, faturamentoContratos] = await Promise.all([
    verOrdens || verCompras ? contarAlertasPrazos(empresaId) : Promise.resolve(null),
    verVeiculos ? contarAlertasVeiculos(empresaId) : Promise.resolve(null),
    verBoletos
      ? prisma.contaReceber.count({ where: { empresaId, boletoStatus: "PAGO", dataRecebimento: { gte: inicioHoje } } })
      : Promise.resolve(0),
    // Cliente aprovou/recusou pelo link e ninguém abriu o orçamento ainda (lib/orcamentos/ciclo)
    verOrcamentos
      ? prisma.orcamento.count({ where: { empresaId, status: { in: ["APROVADO", "REPROVADO"] }, respostaVistaEm: null } })
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
    nfPedidos: nfsDoPedido.length,
    nfPedidoId: nfsDoPedido[0]?.id ?? null,
    ...nfse,
    faturamentoContratos,
    total: totalPrazos + totalVeiculos + boletosPagos + orcamentosRespondidos + nfsDoPedido.length + nfse.nfseAutorizadas + nfse.nfseRejeitadas + nfse.nfseAguardando + faturamentoContratos,
  });
}
