import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const [prazos, veiculos] = await Promise.all([
    contarAlertasPrazos(empresaId),
    contarAlertasVeiculos(empresaId),
  ]);

  const totalVeiculos = veiculos.checklistPendente + veiculos.checklistsComAlertas + veiculos.documentosVencendo + veiculos.veiculosManutencao;

  return NextResponse.json({
    ...prazos,
    ...veiculos,
    total: prazos.total + totalVeiculos,
  });
}
