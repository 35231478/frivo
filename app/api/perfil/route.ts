import { NextRequest, NextResponse } from "next/server";
import { erroDeValidacao, erroNoCampo } from "@/lib/forms/erros-server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { conferirBloqueio, registrarTentativa, limparTentativas } from "@/lib/acesso/limite";
import { z } from "zod";
import { MSG_EMAIL_DO_TECNICO, emModoTecnico } from "@/lib/tecnico/modo";
import { emailDeLoginEmUso, MSG_EMAIL_LOGIN_EM_USO } from "@/lib/acesso/email-unico";

const schema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").optional(),
  email: z.string().trim().email("E-mail inválido").optional(),
  confirmacaoEmail: z.string().trim().email().optional(),
  senhaAtual: z.string().optional(),
  // Telefone de contato (opcional; vazio apaga). Não é login: não pede senha
  telefone: z.string().trim().max(30, "Telefone muito longo").nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const userId = session.user.id;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return erroDeValidacao(parsed.error, parsed.error.errors[0]?.message ?? "Dados inválidos");
  }
  const { nome, confirmacaoEmail, senhaAtual } = parsed.data;
  // Login compara o texto exato: grava sempre em minúsculas para a pessoa não ficar sem entrar (S9)
  const email = parsed.data.email?.toLowerCase();

  const atual = await prisma.usuario.findUnique({ where: { id: userId }, select: { email: true, senha: true } });
  if (!atual) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

  const data: { nome?: string; email?: string; telefone?: string | null } = {};
  if (nome) data.nome = nome;
  if (parsed.data.telefone !== undefined) data.telefone = parsed.data.telefone || null;

  if (email && email !== atual.email.toLowerCase()) {
    // App do técnico: o técnico é ligado às OS dele pelo e-mail de login. Trocando aqui, ele perderia
    // o acesso até o escritório acertar — quem troca é o escritório, pela ficha do colaborador (que
    // leva o login junto). Vale no servidor: a tela do app só mostra o e-mail, mas a rota também recusa.
    if (emModoTecnico(session.user)) return NextResponse.json({ erro: MSG_EMAIL_DO_TECNICO }, { status: 403 });
    if (confirmacaoEmail?.toLowerCase() !== email) {
      return erroNoCampo("confirmacaoEmail", "A confirmação de e-mail não coincide.");
    }
    // Trocar o e-mail de LOGIN exige a senha atual: sessão roubada não troca a conta de dono (S9)
    const bloqueio = await conferirBloqueio("TROCA_SENHA", { usuarioId: userId });
    if (bloqueio.bloqueado) {
      return NextResponse.json({ erro: `Muitas tentativas. Aguarde ${bloqueio.minutos} min.` }, { status: 429 });
    }
    const senhaOk = senhaAtual ? await bcrypt.compare(senhaAtual, atual.senha ?? "") : false;
    if (!senhaOk) {
      await registrarTentativa("TROCA_SENHA", { usuarioId: userId });
      return erroNoCampo("senhaAtual", "Informe a senha atual para trocar o e-mail de login.");
    }
    await limparTentativas("TROCA_SENHA", { usuarioId: userId });

    // Único no Frivo inteiro (o login procura em todas as empresas) — lib/acesso/email-unico. A mensagem é a
    // mesma de todos os lugares que criam login (decisão da Leva I.2); só chega aqui quem já provou a senha
    // atual, com limite de tentativas, então não serve para varrer e-mails.
    if (await emailDeLoginEmUso(email, userId)) return erroNoCampo("email", MSG_EMAIL_LOGIN_EM_USO, 409);
    data.email = email;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ erro: "Nenhuma alteração informada." }, { status: 400 });
  }

  const atualizado = await prisma.usuario.update({
    where: { id: userId },
    data,
    select: { nome: true, email: true, telefone: true },
  });
  return NextResponse.json(atualizado);
}
