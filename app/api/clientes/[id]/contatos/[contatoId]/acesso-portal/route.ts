import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { acessoPortalSchema } from "@/lib/validations";
import { gerarSenhaProvisoria } from "@/lib/portal/gerar-senha";
import { emailDePortalEmUso, MSG_EMAIL_PORTAL_EM_USO } from "@/lib/acesso/email-unico";

type Params = { params: Promise<{ id: string; contatoId: string }> };

/*
 * Senha do portal: a equipe NÃO define a senha de ninguém. Ao liberar o acesso (e em "Gerar nova senha
 * provisória") o sistema gera uma provisória, grava SÓ o hash (bcrypt), marca a troca obrigatória
 * (`trocarSenha`) e devolve a senha em texto UMA vez, nesta resposta, para quem liberou repassar ao contato.
 * A coluna antiga `senha_provisoria` (texto legível) não é mais lida nem gravada com valor: só é zerada.
 */

// Concede/atualiza acesso ao portal para um contato do cliente.
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const contato = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId } });
  if (!contato) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  const parsed = acessoPortalSchema.safeParse(await req.json());
  if (!parsed.success) {
    // A mensagem do campo (ex.: "E-mail inválido"), não um "Dados inválidos" genérico
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // E-mail de acesso único entre os contatos com portal de TODAS as empresas: o login do portal procura em
  // todas (lib/auth-portal) — lib/acesso/email-unico. O próprio contato não conflita consigo.
  if (await emailDePortalEmUso(d.email, contatoId)) return NextResponse.json({ erro: MSG_EMAIL_PORTAL_EM_USO }, { status: 409 });

  // Acesso novo (sem senha ainda): o sistema gera a provisória. Já com acesso: muda e-mail e permissões, a senha fica.
  const data: Record<string, unknown> = { email: d.email, permissoes: d.permissoes, senhaProvisoria: null };
  const senhaGerada = contato.senha ? null : gerarSenhaProvisoria();
  if (senhaGerada) { data.senha = await bcrypt.hash(senhaGerada, 12); data.trocarSenha = true; }
  if (!contato.acessoConcedidoEm) data.acessoConcedidoEm = new Date();

  const atualizado = await prisma.contatoCliente.update({
    where: { id: contatoId },
    data,
    select: { id: true, email: true, permissoes: true, senha: true, acessoConcedidoEm: true },
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
    // Só a senha gerada nesta requisição (nunca a gravada): aparece uma vez, para repassar
    senhaProvisoria: senhaGerada,
    acessoConcedidoEm: atualizado.acessoConcedidoEm,
    portalAtivado: !!atualizado.senha,
  });
}

// "Gerar nova senha provisória": nova senha gerada, só o hash gravado, troca obrigatória marcada; o texto
// vai só nesta resposta. As sessões abertas do contato caem (a senha mudou).
export async function POST(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const contato = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId } });
  if (!contato) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });
  if (!contato.email) return NextResponse.json({ erro: "Contato sem e-mail de acesso" }, { status: 400 });
  // Sem acesso ainda, a senha nova LIBERA o acesso: o e-mail não pode ser acesso de outro contato do Frivo
  if (!contato.senha && await emailDePortalEmUso(contato.email, contatoId))
    return NextResponse.json({ erro: MSG_EMAIL_PORTAL_EM_USO }, { status: 409 });

  const novaSenha = gerarSenhaProvisoria();
  const atualizado = await prisma.contatoCliente.update({
    where: { id: contatoId },
    data: {
      senha: await bcrypt.hash(novaSenha, 12),
      senhaProvisoria: null,
      trocarSenha: true,
      acessoConcedidoEm: contato.acessoConcedidoEm ?? new Date(),
    },
    select: { id: true, email: true, acessoConcedidoEm: true },
  });
  await prisma.cliente.update({ where: { id }, data: { portalAtivo: true } });

  return NextResponse.json({
    id: atualizado.id,
    email: atualizado.email,
    temAcesso: true,
    senhaProvisoria: novaSenha,
    acessoConcedidoEm: atualizado.acessoConcedidoEm,
  });
}

// Revoga o acesso ao portal (apaga hash e qualquer senha em texto antiga).
export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, contatoId } = await params;
  const empresaId = session.user!.empresaId;

  const contato = await prisma.contatoCliente.findFirst({ where: { id: contatoId, clienteId: id, empresaId } });
  if (!contato) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });

  await prisma.contatoCliente.update({ where: { id: contatoId }, data: { senha: null, senhaProvisoria: null, trocarSenha: false } });
  return NextResponse.json({ ok: true });
}
