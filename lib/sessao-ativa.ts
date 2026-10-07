import { cache } from "react";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

/**
 * Sessão (JWT) x cadastro atual: o token é assinado no login e valeria até expirar, mesmo com o
 * usuário (ou a empresa) já inativados. A cada leitura da sessão no servidor (`auth()` em páginas
 * e APIs) conferimos no banco: inativo → a sessão deixa de existir na requisição seguinte.
 *
 * Falha de banco não derruba ninguém (a própria requisição já vai falhar ao consultar o banco);
 * só um cadastro inativo ou removido encerra a sessão. `cache`: layout e página chamam `auth()`
 * na mesma renderização — uma consulta só por requisição (fora do React, não memoriza).
 */
export const usuarioSegueAtivo = cache(async (usuarioId: string): Promise<boolean> => {
  try {
    const u = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { ativo: true, empresa: { select: { ativo: true } } },
    });
    return !!u && u.ativo && u.empresa.ativo;
  } catch (e) {
    console.error("[sessao] não foi possível conferir o usuário", e);
    return true;
  }
});

/** Callback `jwt` do runtime Node: depois do login, a cada leitura confere se o usuário segue ativo. */
export async function conferirTokenAtivo(token: JWT | null, acabouDeEntrar: boolean): Promise<JWT | null> {
  if (!token || acabouDeEntrar) return token; // no login o authorize já exigiu usuário/empresa ativos
  const id = typeof token.id === "string" ? token.id : null;
  if (!id) return null;
  return (await usuarioSegueAtivo(id)) ? token : null;
}

/** Cookies da sessão do painel (com prefixo seguro e em pedaços). Não toca no cookie do portal. */
export const COOKIE_SESSAO = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;
