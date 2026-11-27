import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getPortalSession } from "@/lib/auth-portal";
import { problemaSenha } from "@/lib/acesso/senha";
import { conferirBloqueio, limparTentativas, registrarTentativa } from "@/lib/acesso/limite";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { regravarSessaoPortal } from "@/lib/portal/sessao-cookie-portal";

/**
 * Portal do cliente: o PRÓPRIO contato troca a senha (o contato vem da sessão; nada de id no corpo). Exige a
 * senha recebida (com limite de erros por contato), a nova segue a regra de senha forte e precisa ser
 * diferente. Depois da troca: a troca obrigatória é limpa, as outras sessões (com a senha antiga) caem e
 * esta continua (o cookie do portal é regravado com os atributos certos, sem a marca).
 */
const schema = z.object({
  senhaAtual: z.string().min(1, "Informe a senha recebida."),
  novaSenha: z.string().superRefine((s, ctx) => { const p = problemaSenha(s); if (p) ctx.addIssue({ code: "custom", message: p }); }),
  confirmar: z.string().min(1, "Confirme a nova senha."),
}).strict();

export async function PATCH(req: NextRequest) {
  const sessao = await getPortalSession({ comTroca: true });
  if (!sessao?.user?.id) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const contatoId = sessao.user.id;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { senhaAtual, novaSenha, confirmar } = parsed.data;
  if (novaSenha !== confirmar) return NextResponse.json({ erro: "A confirmação não confere com a nova senha." }, { status: 400 });

  const alvos = { usuarioId: contatoId };
  const bloqueio = await conferirBloqueio("PORTAL_TROCA_SENHA", alvos);
  if (bloqueio.bloqueado) {
    return NextResponse.json({ erro: `Muitas tentativas com a senha recebida errada. Aguarde ${bloqueio.minutos} min e tente de novo.` }, { status: 429 });
  }

  const contato = await prisma.contatoCliente.findUnique({ where: { id: contatoId }, select: { senha: true, email: true } });
  if (!contato?.senha) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!(await bcrypt.compare(senhaAtual, contato.senha))) {
    await registrarTentativa("PORTAL_TROCA_SENHA", alvos);
    return NextResponse.json({ erro: "Senha recebida incorreta." }, { status: 400 });
  }
  if (senhaAtual === novaSenha) return NextResponse.json({ erro: "A nova senha precisa ser diferente da recebida." }, { status: 400 });
  await limparTentativas("PORTAL_TROCA_SENHA", alvos);

  const hash = await bcrypt.hash(novaSenha, 12);
  await prisma.contatoCliente.update({ where: { id: contatoId }, data: { senha: hash, trocarSenha: false, senhaProvisoria: null } });
  if (contato.email) await limparTentativas("PORTAL_LOGIN", { email: contato.email });

  const res = NextResponse.json({ ok: true });
  await regravarSessaoPortal(req, res, (t) => ({ ...t, fs: impressaoDaSenha(hash), trocarSenha: false }));
  return res;
}
