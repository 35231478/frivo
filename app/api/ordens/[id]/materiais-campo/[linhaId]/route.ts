import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { ErroEstoque } from "@/lib/estoque/servidor";
import { quantidadeSchema } from "@/lib/tecnico/materiais";
import { corrigirMaterialEscritorio, estornarMaterialEscritorio } from "@/lib/execucao/materiais-campo";
import type { Session } from "next-auth";

type Params = { params: Promise<{ id: string; linhaId: string }> };

/** Corrigir/estornar o lançamento de OUTRA pessoa é do escritório: no modo técnico, nunca (cada um mexe só no seu, pelo app). */
async function doEscritorio(): Promise<{ erro: Response } | { session: Session }> {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return { erro: guard.resposta };
  if (escopoDaSessao(guard.session).restrito) return { erro: NextResponse.json({ erro: "Correção do material usado é feita pelo escritório." }, { status: 403 }) };
  return { session: guard.session };
}

const responder = (r: { ok: true; status: number; dados: unknown } | { ok: false; status: number; erro: string }) =>
  r.ok ? NextResponse.json(r.dados, { status: r.status }) : NextResponse.json({ erro: r.erro }, { status: r.status });

/** PATCH { quantidade } — corrige a quantidade (o estoque acerta só a diferença; fica quem corrigiu e quando). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await doEscritorio();
  if ("erro" in g) return g.erro;
  const { id, linhaId } = await params;
  const body = await req.json().catch(() => null);
  const q = quantidadeSchema.safeParse(body?.quantidade);
  if (!q.success) return NextResponse.json({ erro: q.error.issues[0]?.message ?? "Quantidade inválida." }, { status: 400 });
  try {
    return responder(await corrigirMaterialEscritorio(g.session.user.empresaId, id, linhaId, g.session.user.id, q.data));
  } catch (e) {
    if (e instanceof ErroEstoque) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }
}

/** DELETE — estorna o lançamento: sai da OS (fica no registro, com quem estornou) e o estoque volta. */
export async function DELETE(_: NextRequest, { params }: Params) {
  const g = await doEscritorio();
  if ("erro" in g) return g.erro;
  const { id, linhaId } = await params;
  try {
    return responder(await estornarMaterialEscritorio(g.session.user.empresaId, id, linhaId, g.session.user.id));
  } catch (e) {
    if (e instanceof ErroEstoque) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }
}
