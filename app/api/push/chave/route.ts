import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { chavesVapid } from "@/lib/push/config";

/**
 * GET /api/push/chave — a chave PÚBLICA do VAPID, lida do ambiente na hora (não da compilação).
 * Sem as chaves no ambiente: { ligado: false } e a tela nem oferece ativar.
 */
export async function GET() {
  if (!(await auth())) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const chaves = chavesVapid();
  return NextResponse.json(chaves ? { ligado: true, chave: chaves.publica } : { ligado: false, chave: null });
}
