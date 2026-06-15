import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acessoPortalSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string; contatoId: string }> };

// Gera uma senha provisória legível (sem caracteres ambíguos).
function gerarSenha(tamanho = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < tamanho; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

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

  const data: any = { email: d.email, permissoes: d.permissoes };
  if (d.senha && d.senha.length >= 4) {
    data.senha = await bcrypt.hash(d.senha, 12);
    data.senhaProvisoria = d.senha; // texto legível p/ consulta do gestor
  } else if (!contato.senha) {
    return NextResponse.json({ erro: "Defina uma senha de acesso (mín. 4 caracteres)" }, { status: 400 });
  }
  if (!contato.acessoConcedidoEm) data.acessoConcedidoEm = new Date();

  const atualizado = await prisma.contatoCliente.update({
    where: { id: contatoId },
    data,
    select: { id: true, email: true, permissoes: true, senha: true, senhaProvisoria: true, acessoConcedidoEm: true },
  });

  // Conceder acesso ativa automaticamente o portal do cliente.
  if (atualizado.senha) {
    await prisma.cliente.update({ where: { id }, data: { portalAtivo: true } });
  }

  return NextResponse.json({
    id: atualizado.id,
    email: atualizado.email,
    permissoes: atualizado.permissoes,
    temAcesso: !!atualizado.senha,
    senhaProvisoria: atualizado.senhaProvisoria,
    acessoConcedidoEm: atualizado.acessoConcedidoEm,
    portalAtivado: !!atualizado.senha,
  });
}

// Redefine a senha do portal: gera nova senha aleatória, salva e retorna em texto.
export async function POST(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const contato = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId } });
  if (!contato) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });
  if (!contato.email) return NextResponse.json({ erro: "Contato sem e-mail de acesso" }, { status: 400 });

  const novaSenha = gerarSenha();
  const atualizado = await prisma.contatoCliente.update({
    where: { id: contatoId },
    data: {
      senha: await bcrypt.hash(novaSenha, 12),
      senhaProvisoria: novaSenha,
      acessoConcedidoEm: contato.acessoConcedidoEm ?? new Date(),
    },
    select: { id: true, email: true, senhaProvisoria: true, acessoConcedidoEm: true },
  });
  await prisma.cliente.update({ where: { id }, data: { portalAtivo: true } });

  return NextResponse.json({
    id: atualizado.id,
    email: atualizado.email,
    temAcesso: true,
    senhaProvisoria: atualizado.senhaProvisoria,
    acessoConcedidoEm: atualizado.acessoConcedidoEm,
  });
}

// Revoga o acesso ao portal (mantém o registro/senha provisória como "Revogado").
export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const contato = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId } });
  if (!contato) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  await prisma.contatoCliente.update({ where: { id: contatoId }, data: { senha: null } });
  return NextResponse.json({ ok: true });
}
