import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { contarAlertasPrazos } from "@/lib/prazo-server";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const alertas = await contarAlertasPrazos(session.user!.empresaId);
  return NextResponse.json(alertas);
}
