import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { podeExportar } from "@/lib/exportacao/arquivos";

export const MSG_SO_ADMIN = "Só o administrador da empresa pode exportar os dados.";

/**
 * Quem pode exportar os dados da empresa: o ADMINISTRADOR, conferido no BANCO (não só no cookie da sessão,
 * que pode estar velho): usuário ativo, desta empresa, com papel de administrador.
 */
export async function exigirAdminExportacao(): Promise<
  | { ok: true; empresaId: string; usuario: { id: string; nome: string } }
  | { ok: false; resposta: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id || !session.user.empresaId) return { ok: false, resposta: NextResponse.json({ erro: "Não autorizado" }, { status: 401 }) };
  const u = await prisma.usuario.findFirst({
    where: { id: session.user.id, empresaId: session.user.empresaId, ativo: true },
    select: { id: true, nome: true, role: true },
  });
  if (!u || !podeExportar(u.role)) return { ok: false, resposta: NextResponse.json({ erro: MSG_SO_ADMIN }, { status: 403 }) };
  return { ok: true, empresaId: session.user.empresaId, usuario: { id: u.id, nome: u.nome } };
}
