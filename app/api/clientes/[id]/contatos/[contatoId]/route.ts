import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { contatoClienteSchema, contatoContextoSchema, dadosParciais } from "@/lib/validations";
import { contatoSeguro } from "@/lib/contato-cliente";

type Params = { params: Promise<{ id: string; contatoId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contatoCliente.findFirst({
    where: { id: contatoId, clienteId: id, empresaId },
  });
  if (!existente) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = contatoClienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }

  const atualizado = await prisma.contatoCliente.update({
    where: { id: contatoId },
    data: parsed.data,
  });

  return NextResponse.json(contatoSeguro(atualizado));
}

/**
 * PATCH: edição no contexto (de dentro da OS e do orçamento) — nome, cargo, telefone e e-mail, e só o que
 * mudou. Mesma permissão da edição completa; tipo, principal e o acesso ao portal não são tocados.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = contatoContextoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const dados = dadosParciais(parsed.data);
  if (!Object.keys(dados).length) return NextResponse.json({ erro: "Nada para alterar." }, { status: 400 });
  const atualizado = await prisma.contatoCliente.update({ where: { id: contatoId }, data: dados });
  return NextResponse.json(contatoSeguro(atualizado));
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contatoCliente.findFirst({
    where: { id: contatoId, clienteId: id, empresaId },
  });
  if (!existente) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  await prisma.contatoCliente.update({ where: { id: contatoId }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
