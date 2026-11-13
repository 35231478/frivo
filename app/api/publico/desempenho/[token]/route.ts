import { NextRequest, NextResponse } from "next/server";
import { painelDaTv } from "@/lib/desempenho/servidor";

export const dynamic = "force-dynamic";

/**
 * Modo TV (sem login): o ranking do mês corrente e o prêmio em disputa da empresa dona do link.
 * Só leitura. A resposta não tem bônus, valor de faixa, composição nem penalidades — só posição,
 * nome, escore e faixa. Link desligado ou trocado = 404.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const painel = await painelDaTv((await params).token);
  if (!painel) return NextResponse.json({ erro: "Painel não encontrado" }, { status: 404 });
  return NextResponse.json(painel, { headers: { "Cache-Control": "no-store" } });
}
