import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acessoPortalSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string; contatoId: string }> };

// Concede/atualiza acesso ao portal para um contato do cliente.
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const contato = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId } });
  if (!contato) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  const parsed = acessoPortalSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // E-mail de acesso único entre contatos com portal habilitado da empresa
  const conflito = await prisma.contatoCliente.findFirst({
    where: { empresaId, email: { equals: d.email, mode: "insensitive" }, senha: { not: null }, id: { not: contatoId } },
    select: { id: true },
  });
  if (conflito) return NextResponse.json({ erro: "Já existe acesso de portal com este e-mail" }, { status: 409 });

  const data: any = {
    email: d.email,
    ativo: d.ativo,
    permissoes: d.permissoes,
  };
  if (d.senha && d.senha.length >= 4) {
    data.senha = await bcrypt.hash(d.senha, 12);
  } else if (!contato.senha) {
    return NextResponse.json({ erro: "Defina uma senha de acesso (mín. 4 caracteres)" }, { status: 400 });
  }

  const atualizado = await prisma.contatoCliente.update({
    where: { id: contatoId },
    data,
    select: { id: true, email: true, ativo: true, permissoes: true, senha: true },
  });

  return NextResponse.json({ ...atualizado, temAcesso: !!atualizado.senha });
}

// Revoga o acesso ao portal.
export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const contato = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId } });
  if (!contato) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  await prisma.contatoCliente.update({ where: { id: contatoId }, data: { senha: null, permissoes: undefined } });
  return NextResponse.json({ ok: true });
}
