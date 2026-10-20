import { NextRequest, NextResponse } from "next/server";
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
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { senhaAtual, novaSenha, confirmar } = parsed.data;

  if (novaSenha !== confirmar) {
    return NextResponse.json({ erro: "A confirmação da nova senha não coincide." }, { status: 400 });
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
    return NextResponse.json({ erro: "Senha atual incorreta." }, { status: 400 });
  }
  if (senhaAtual === novaSenha) {
    return NextResponse.json({ erro: "A nova senha precisa ser diferente da atual." }, { status: 400 });
  }
  await limparTentativas("TROCA_SENHA", alvos);

  const hash = await bcrypt.hash(novaSenha, 12);
  await prisma.usuario.update({ where: { id: userId }, data: { senha: hash } });

  const res = NextResponse.json({ ok: true });
  await regravarSessaoAtual(req, res, (t) => ({ ...t, fs: impressaoDaSenha(hash) }));
  return res;
}
