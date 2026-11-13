import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { mesPedido, veValores } from "@/lib/desempenho/api";
import { fichaDoColaborador } from "@/lib/desempenho/servidor";

/** Ficha do colaborador no mês: escore, composição com os números, faixa e bônus projetado. "Desempenho › Visualizar". */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "visualizar");
  if (guard.erro) return guard.resposta;
  const ficha = await fichaDoColaborador(guard.session.user.empresaId, (await params).id, mesPedido(req), veValores(guard.session));
  if (!ficha) return NextResponse.json({ erro: "Este colaborador não participa do Desempenho." }, { status: 404 });
  return NextResponse.json(ficha, { headers: { "Cache-Control": "private, no-store" } });
}
