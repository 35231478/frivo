import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);

  const [prazos, veiculos, boletosPagos] = await Promise.all([
    contarAlertasPrazos(empresaId),
    contarAlertasVeiculos(empresaId),
    prisma.contaReceber.count({ where: { empresaId, boletoStatus: "PAGO", dataRecebimento: { gte: inicioHoje } } }),
  ]);

  const totalVeiculos = veiculos.checklistPendente + veiculos.checklistsComAlertas + veiculos.documentosVencendo + veiculos.veiculosManutencao;

  return NextResponse.json({
    ...prazos,
    ...veiculos,
    boletosPagos,
    total: prazos.total + totalVeiculos + boletosPagos,
  });
}
