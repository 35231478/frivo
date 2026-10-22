import { cache } from "react";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";

/**
 * Sessão do PORTAL (JWT de 30 dias) x cadastro atual: revogar o acesso, inativar o contato ou o
 * cliente, desligar o portal ou redefinir a senha derrubam a sessão na requisição seguinte — sem
 * esperar o token expirar. As permissões também são relidas do banco a cada leitura, então tirar
 * uma permissão do contato vale na hora.
 *
 * Falha de banco não derruba ninguém (a requisição em si já vai falhar ao consultar o banco).
 * `cache`: layout e página leem a sessão na mesma renderização — uma consulta só por requisição.
 */
const lerContato = cache(async (contatoId: string) => {
  try {
    const c = await prisma.contatoCliente.findUnique({
      where: { id: contatoId },
      select: {
        ativo: true,
        senha: true,
        permissoes: true,
        cliente: { select: { ativo: true, portalAtivo: true, empresa: { select: { ativo: true } } } },
      },
    });
    return c ?? "removido";
  } catch (e) {
    console.error("[portal] não foi possível conferir o contato", e);
    return null;
  }
});

/** Callback `jwt` do portal: confere o cadastro e atualiza as permissões a cada leitura. */
export async function conferirTokenPortal(token: JWT | null, acabouDeEntrar: boolean): Promise<JWT | null> {
  if (!token || acabouDeEntrar) return token; // no login o authorize já exigiu contato/cliente ativos
  const id = typeof token.id === "string" ? token.id : null;
  if (!id) return null;
  const c = await lerContato(id);
  if (c === null) return token;
  if (c === "removido" || !c.ativo || !c.senha || !c.cliente.ativo || !c.cliente.portalAtivo || !c.cliente.empresa.ativo) {
    return null;
  }
  const permissoes = (c.permissoes as Record<string, boolean> | null) ?? {};
  // Senha redefinida depois deste login (impressão diferente) → sessão antiga cai
  const atual = impressaoDaSenha(c.senha);
  if (typeof token.fs === "string" && token.fs !== atual) return null;
  // O campo `permissoes` do JWT é tipado para o painel; no portal ele guarda as chaves do contato
  return { ...token, fs: atual, permissoes: permissoes as unknown as JWT["permissoes"] };
}
