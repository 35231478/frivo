import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { mesPedido } from "@/lib/desempenho/api";
import { desempenhoAtivo, fichaDoColaborador, fichaParaOColaborador } from "@/lib/desempenho/servidor";
import { tecnicoDaSessao } from "@/lib/tecnico/sessao";

/**
 * O colaborador vê o DELE: a própria ficha do mês (escore, composição, posição, faixa e o bônus
 * dele — projetado enquanto o mês está aberto, definitivo depois de fechado). Não pede permissão de Desempenho — pede estar logado e ligado a um colaborador.
 * Nunca devolve a ficha de outra pessoa: o colaborador vem da sessão, não da URL.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const semCache = { headers: { "Cache-Control": "private, no-store" } };
  const tecnico = await tecnicoDaSessao(session);
  if (!tecnico || !(await desempenhoAtivo(session.user.empresaId))) return NextResponse.json({ participa: false, ficha: null }, semCache);
  const ficha = await fichaDoColaborador(session.user.empresaId, tecnico.id, mesPedido(req), true);
  // A avaliação vai como média; o que o cliente escreveu (ressalva, reclamação) não vai para o app
  return NextResponse.json({ participa: !!ficha, ficha: ficha && fichaParaOColaborador(ficha) }, semCache);
}
