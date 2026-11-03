import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CHAVE_PREFERENCIA, lerPreferenciaTabela, preferenciaTabelaSchema } from "@/lib/preferencias";

/**
 * Preferência pessoal de tela (larguras/colunas das tabelas). SÓ a do próprio usuário da sessão:
 * a chave da linha é (usuarioId da sessão, chave da URL); não existe jeito de ler ou gravar a de outro.
 * Não tem permissão de módulo: qualquer usuário logado guarda as suas.
 */
type Params = { params: Promise<{ chave: string }> };

const chaveValida = (chave: string) => CHAVE_PREFERENCIA.test(chave);

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { chave } = await params;
  if (!chaveValida(chave)) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const pref = await prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId: session.user!.id, chave } }, select: { valor: true } });
  return NextResponse.json({ chave, valor: pref ? lerPreferenciaTabela(pref.valor) : null });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { chave } = await params;
  if (!chaveValida(chave)) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const parsed = preferenciaTabelaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const usuarioId = session.user!.id;
  await prisma.preferenciaUsuario.upsert({
    where: { usuarioId_chave: { usuarioId, chave } },
    create: { usuarioId, chave, valor: parsed.data },
    update: { valor: parsed.data },
  });
  return NextResponse.json({ chave, valor: parsed.data });
}
