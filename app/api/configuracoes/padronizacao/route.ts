import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { planejarLimpezaCaixa, aplicarLimpezaCaixa } from "@/lib/texto/limpeza";

/**
 * Padronização de digitação dos dados antigos. GET = prévia (lista o que mudaria, não grava);
 * POST = aplicar. Só quem gerencia as Configurações. A empresa vem sempre da sessão (multiempresa).
 */

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "configuracoes", "gerenciar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const plano = await planejarLimpezaCaixa(session.user!.empresaId);
  return NextResponse.json(plano);
}

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "configuracoes", "gerenciar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const resultado = await aplicarLimpezaCaixa(session.user!.empresaId);
  return NextResponse.json(resultado);
}
