import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { problemaSenha } from "@/lib/acesso/senha";

/**
 * Acesso ao app do colaborador (Equipes › Colaboradores › Acesso ao app).
 *
 * Liberar o acesso cria/liga um usuário de LOGIN com papel TECNICO, da mesma empresa, ligado ao
 * colaborador pelo e-mail (a mesma convenção do resto do sistema — sem coluna nova). Esse usuário cai
 * no app "Meu dia" e tem o painel travado (lib/tecnico/modo.ts). Desligar o acesso inativa o login
 * (bloqueia a entrada sem apagar o colaborador). Gerenciar logins exige Configurações › gerenciar.
 *
 * LGPD: nada de senha em texto — só o hash (bcrypt) é gravado. A permissão é assada no login (JWT),
 * então ativar/desativar vale no PRÓXIMO login (a UI avisa).
 */

type Params = { params: Promise<{ id: string }> };

const SELECT_USUARIO = { id: true, email: true, ativo: true, role: true } as const;

/** Usuário de login ligado ao colaborador — por e-mail, sem diferença de maiúsculas, na empresa. */
async function usuarioLigado(empresaId: string, email: string | null | undefined) {
  const e = (email ?? "").trim();
  if (!e) return null;
  return prisma.usuario.findFirst({
    where: { empresaId, email: { equals: e, mode: "insensitive" } },
    select: SELECT_USUARIO,
  });
}

function estado(email: string | null, usuario: { ativo: boolean; role: string } | null) {
  return { email: email || null, temLogin: !!usuario, acessoAtivo: !!usuario?.ativo, role: usuario?.role ?? null };
}

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const tecnico = await prisma.tecnico.findFirst({ where: { id, empresaId }, select: { email: true } });
  if (!tecnico) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(estado(tecnico.email, await usuarioLigado(empresaId, tecnico.email)));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const tecnico = await prisma.tecnico.findFirst({ where: { id, empresaId }, select: { id: true, nome: true, email: true } });
  if (!tecnico) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const acessoAtivo = body?.acessoAtivo === true;
  const senha: string | undefined = typeof body?.senha === "string" && body.senha.length > 0 ? body.senha : undefined;
  const email = (tecnico.email ?? "").trim();
  const usuario = await usuarioLigado(empresaId, email);

  // Desligar o acesso: inativa o login (bloqueia a entrada), sem apagar nada.
  if (!acessoAtivo) {
    if (usuario?.ativo) await prisma.usuario.update({ where: { id: usuario.id }, data: { ativo: false } });
    return NextResponse.json(estado(email, await usuarioLigado(empresaId, email)));
  }

  // Ligar o acesso precisa de e-mail (é a identidade de login).
  if (!email) {
    return NextResponse.json({ erro: "Defina o e-mail do colaborador (Dados pessoais) antes de liberar o acesso ao app." }, { status: 400 });
  }
  // E-mail único por empresa: outro colaborador ativo com o mesmo e-mail deixaria o vínculo ambíguo.
  const outro = await prisma.tecnico.findFirst({
    where: { empresaId, ativo: true, id: { not: tecnico.id }, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (outro) return NextResponse.json({ erro: "Outro colaborador ativo já usa este e-mail. Use um e-mail único por colaborador." }, { status: 409 });

  if (senha) {
    const prob = problemaSenha(senha);
    if (prob) return NextResponse.json({ erro: prob }, { status: 400 });
  }

  if (usuario) {
    // Não sequestra uma conta de PAINEL com o mesmo e-mail: isso é login de gestão, não do app.
    if (usuario.role !== "TECNICO") {
      return NextResponse.json({ erro: "Já existe um usuário de painel com este e-mail. Use um e-mail só para o acesso do técnico (ou gerencie em Configurações › Usuários)." }, { status: 409 });
    }
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { ativo: true, ...(senha ? { senha: await bcrypt.hash(senha, 12) } : {}) },
    });
    return NextResponse.json(estado(email, await usuarioLigado(empresaId, email)));
  }

  // Primeiro acesso: cria o login com senha inicial (obrigatória), papel TECNICO e o perfil de Técnico.
  if (!senha) return NextResponse.json({ erro: "Defina uma senha inicial para liberar o acesso." }, { status: 400 });
  const perfil = await prisma.perfilAcesso.findFirst({
    where: { empresaId, tipo: "TECNICO" },
    orderBy: [{ padraoSistema: "desc" }, { criadoEm: "asc" }],
    select: { id: true },
  });
  if (!perfil) return NextResponse.json({ erro: "Nenhum perfil de Técnico encontrado. Crie um em Configurações › Perfis de acesso." }, { status: 400 });
  await prisma.usuario.create({
    data: { empresaId, nome: tecnico.nome, email, role: "TECNICO", perfilAcessoId: perfil.id, ativo: true, senha: await bcrypt.hash(senha, 12) },
  });
  return NextResponse.json(estado(email, await usuarioLigado(empresaId, email)));
}
