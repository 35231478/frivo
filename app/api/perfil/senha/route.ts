import { NextRequest, NextResponse } from "next/server";
import { erroDeValidacao, erroNoCampo } from "@/lib/forms/erros-server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { problemaSenha } from "@/lib/acesso/senha";
import { conferirBloqueio, limparTentativas, registrarTentativa } from "@/lib/acesso/limite";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { regravarSessaoAtual } from "@/lib/acesso/sessao-cookie";

/**
 * Meu perfil › Segurança: troca a PRÓPRIA senha (o usuário vem da sessão; nada de id no corpo).
 * Exige a senha atual (com limite de erros, para quem pegou uma sessão aberta não ficar chutando),
 * a nova segue a regra de senha forte. Depois da troca, as outras sessões abertas caem e esta
 * continua (o cookie é regravado com a impressão da senha nova).
 */
const schema = z.object({
  senhaAtual: z.string().min(1, "Informe a senha atual"),
  novaSenha: z.string().superRefine((s, ctx) => { const p = problemaSenha(s); if (p) ctx.addIssue({ code: "custom", message: p }); }),
  confirmar: z.string().min(1, "Confirme a nova senha"),
}).strict();

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const userId = session.user.id;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // ERRO NO CAMPO: o mesmo `erro` de antes (a 1ª mensagem) + `campos` (senhaAtual, novaSenha, confirmar)
    return erroDeValidacao(parsed.error, parsed.error.issues[0]?.message ?? "Dados inválidos");
  }
  const { senhaAtual, novaSenha, confirmar } = parsed.data;

  if (novaSenha !== confirmar) {
    return erroNoCampo("confirmar", "A confirmação da nova senha não coincide.");
  }

  const alvos = { usuarioId: userId };
  const bloqueio = await conferirBloqueio("TROCA_SENHA", alvos);
  if (bloqueio.bloqueado) {
    return NextResponse.json({ erro: `Muitas tentativas com a senha atual errada. Aguarde ${bloqueio.minutos} min e tente de novo.` }, { status: 429 });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: userId }, select: { senha: true } });
  if (!usuario) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

  const ok = await bcrypt.compare(senhaAtual, usuario.senha);
  if (!ok) {
    await registrarTentativa("TROCA_SENHA", alvos);
    return erroNoCampo("senhaAtual", "Senha atual incorreta.");
  }
  if (senhaAtual === novaSenha) {
    return erroNoCampo("novaSenha", "A nova senha precisa ser diferente da atual.");
  }
  await limparTentativas("TROCA_SENHA", alvos);

  const hash = await bcrypt.hash(novaSenha, 12);
  // A própria pessoa trocou: a troca obrigatória do 1º acesso (se havia) está feita
  await prisma.usuario.update({ where: { id: userId }, data: { senha: hash, trocarSenha: false } });

  const res = NextResponse.json({ ok: true });
  await regravarSessaoAtual(req, res, (t) => ({ ...t, fs: impressaoDaSenha(hash), trocarSenha: false }));
  return res;
}
