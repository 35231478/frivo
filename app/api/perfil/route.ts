import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { conferirBloqueio, registrarTentativa, limparTentativas } from "@/lib/acesso/limite";
import { z } from "zod";

const schema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").optional(),
  email: z.string().trim().email("E-mail inválido").optional(),
  confirmacaoEmail: z.string().trim().email().optional(),
  senhaAtual: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const userId = session.user.id;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { nome, confirmacaoEmail, senhaAtual } = parsed.data;
  // Login compara o texto exato: grava sempre em minúsculas para a pessoa não ficar sem entrar (S9)
  const email = parsed.data.email?.toLowerCase();

  const atual = await prisma.usuario.findUnique({ where: { id: userId }, select: { email: true, senha: true } });
  if (!atual) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

  const data: { nome?: string; email?: string } = {};
  if (nome) data.nome = nome;

  if (email && email !== atual.email.toLowerCase()) {
    if (confirmacaoEmail?.toLowerCase() !== email) {
      return NextResponse.json({ erro: "A confirmação de e-mail não coincide." }, { status: 400 });
    }
    // Trocar o e-mail de LOGIN exige a senha atual: sessão roubada não troca a conta de dono (S9)
    const bloqueio = await conferirBloqueio("TROCA_SENHA", { usuarioId: userId });
    if (bloqueio.bloqueado) {
      return NextResponse.json({ erro: `Muitas tentativas. Aguarde ${bloqueio.minutos} min.` }, { status: 429 });
    }
    const senhaOk = senhaAtual ? await bcrypt.compare(senhaAtual, atual.senha ?? "") : false;
    if (!senhaOk) {
      await registrarTentativa("TROCA_SENHA", { usuarioId: userId });
      return NextResponse.json({ erro: "Informe a senha atual para trocar o e-mail de login." }, { status: 400 });
    }
    await limparTentativas("TROCA_SENHA", { usuarioId: userId });

    const emUso = await prisma.usuario.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, id: { not: userId } },
      select: { id: true },
    });
    // Resposta genérica: o 409 antigo confirmava e-mails de outras empresas (S9)
    if (emUso) return NextResponse.json({ erro: "Não foi possível usar este e-mail. Escolha outro endereço." }, { status: 409 });
    data.email = email;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ erro: "Nenhuma alteração informada." }, { status: 400 });
  }

  const atualizado = await prisma.usuario.update({
    where: { id: userId },
    data,
    select: { nome: true, email: true },
  });
  return NextResponse.json(atualizado);
}
