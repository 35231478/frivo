import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";
import { hojeDiaCivil } from "@/lib/fuso";

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

  const inicioHoje = hojeDiaCivil(); // recebimento é dia civil: hoje em Brasília

  const zeroVeiculos = { checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, revisaoChegando: 0 };
  const [prazosBrutos, veiculosBrutos, boletosPagos, orcamentosRespondidos] = await Promise.all([
    verOrdens || verCompras ? contarAlertasPrazos(empresaId) : Promise.resolve(null),
    verVeiculos ? contarAlertasVeiculos(empresaId) : Promise.resolve(null),
    verBoletos
      ? prisma.contaReceber.count({ where: { empresaId, boletoStatus: "PAGO", dataRecebimento: { gte: inicioHoje } } })
      : Promise.resolve(0),
    // Cliente aprovou/recusou pelo link e ninguém abriu o orçamento ainda (lib/orcamentos/ciclo)
    verOrcamentos
      ? prisma.orcamento.count({ where: { empresaId, status: { in: ["APROVADO", "REPROVADO"] }, respostaVistaEm: null } })
      : Promise.resolve(0),
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
    total: totalPrazos + totalVeiculos + boletosPagos + orcamentosRespondidos,
  });
}
