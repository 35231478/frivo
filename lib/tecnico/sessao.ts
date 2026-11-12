/**
 * O técnico de quem está usando o app: o gravado na sessão no login (mesmo e-mail) ou, para quem foi
 * ligado depois do login, o encontrado agora pelo e-mail. Sem técnico = sem "Meu dia".
 */
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { tecnicoDoUsuario } from "@/lib/tecnico/escopo";

export async function tecnicoDaSessao(session: Session) {
  const { empresaId, tecnicoId, email } = session.user;
  if (tecnicoId) {
    const t = await prisma.tecnico.findFirst({ where: { id: tecnicoId, empresaId, ativo: true }, select: { id: true, nome: true } });
    if (t) return t;
  }
  return tecnicoDoUsuario(empresaId, email);
}

export const MSG_SEM_TECNICO = "Seu usuário não está ligado a um técnico ativo (o mesmo e-mail no cadastro de Colaboradores). Peça ao escritório para conferir.";
