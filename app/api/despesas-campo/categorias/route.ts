import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { categoriasParaTela, salvarMapa, soEscritorio } from "@/lib/execucao/despesas";
import { mapaSchema } from "@/lib/tecnico/despesas";

/** A categoria financeira de cada categoria da despesa (padrão: a de mesmo nome). */
export async function GET() {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const fora = soEscritorio(guard.session);
  if (fora) return fora;
  return NextResponse.json(await categoriasParaTela(guard.session.user.empresaId));
}

/** PUT { mapa } — troca as ligações (quem lança contas a pagar). */
export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const fora = soEscritorio(guard.session);
  if (fora) return fora;
  const body = await req.json().catch(() => null);
  const parsed = mapaSchema.safeParse(body?.mapa);
  if (!parsed.success) return NextResponse.json({ erro: "Categorias inválidas." }, { status: 400 });
  const r = await salvarMapa(guard.session.user.empresaId, parsed.data);
  return r.ok ? NextResponse.json(r.dados) : NextResponse.json({ erro: r.erro }, { status: r.status });
}
