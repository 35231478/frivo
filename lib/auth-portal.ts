import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { portalLoginSchema } from "@/lib/validations";
import { apagarTentativas, conferirBloqueio, HASH_FICTICIO, ipDaRequisicao, limparTentativas, registrarTentativa } from "@/lib/acesso/limite";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { conferirTokenPortal } from "@/lib/sessao-portal";

/** Muitas senhas erradas: o formulário recebe o código (com os minutos que faltam), não o motivo. */
class AcessoBloqueado extends CredentialsSignin {
  constructor(minutos: number) {
    super();
    this.code = `bloqueado-${minutos}`;
  }
}

/**
 * Instância NextAuth SEPARADA para o Portal do Cliente.
 * Usa um cookie próprio (frivo.portal-session) para não conflitar com a
 * sessão interna (lib/auth.ts). Autentica os CONTATOS do cliente.
 */
export const {
  handlers: portalHandlers,
  signIn: portalSignIn,
  signOut: portalSignOut,
  auth: portalAuth,
} = NextAuth({
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  basePath: "/api/portal-auth",
  pages: { signIn: "/portal/login", error: "/portal/login" },
  cookies: {
    sessionToken: {
      name: "frivo.portal-session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = portalLoginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.trim();
        const { senha } = parsed.data;

        // Anti força bruta: mesmo limite do login interno, contando por e-mail e por IP
        const alvos = { email, ip: ipDaRequisicao(request?.headers) };
        const bloqueio = await conferirBloqueio("PORTAL_LOGIN", alvos);
        if (bloqueio.bloqueado) throw new AcessoBloqueado(bloqueio.minutos);
        // Conta a tentativa ANTES do bcrypt (requisições paralelas não furam o limite — S6)
        const registros = await registrarTentativa("PORTAL_LOGIN", alvos);

        const contato = await prisma.contatoCliente.findFirst({
          where: {
            email: { equals: email, mode: "insensitive" },
            ativo: true,
            senha: { not: null },
            cliente: { ativo: true, portalAtivo: true },
          },
          include: { cliente: { select: { id: true, nome: true, nomeFantasia: true, empresaId: true } } },
        });

        // E-mail sem acesso também passa pelo bcrypt: o tempo de resposta não revela quem existe
        const ok = await bcrypt.compare(senha, contato?.senha ?? HASH_FICTICIO);
        if (!contato || !contato.senha || !ok) {
          return null;
        }
        await limparTentativas("PORTAL_LOGIN", alvos);
        await apagarTentativas(registros);

        await prisma.contatoCliente.update({
          where: { id: contato.id },
          data: { ultimoAcesso: new Date() },
        });

        return {
          id: contato.id,
          email: contato.email ?? email,
          name: contato.nome,
          clienteId: contato.clienteId,
          clienteNome: contato.cliente.nomeFantasia ?? contato.cliente.nome,
          empresaId: contato.cliente.empresaId,
          permissoes: (contato.permissoes as Record<string, boolean> | null) ?? {},
          fs: impressaoDaSenha(contato.senha),
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.clienteId = (user as any).clienteId;
        token.clienteNome = (user as any).clienteNome;
        token.empresaId = (user as any).empresaId;
        token.permissoes = (user as any).permissoes;
        token.fs = (user as any).fs;
      }
      // Revogar acesso, inativar contato/cliente, desligar o portal ou trocar a senha
      // derrubam a sessão na leitura seguinte; permissões são relidas do banco.
      return conferirTokenPortal(token, !!user);
    },
    session({ session, token }) {
      (session.user as any).id = token.id;
      (session.user as any).clienteId = token.clienteId;
      (session.user as any).clienteNome = token.clienteNome;
      (session.user as any).empresaId = token.empresaId;
      (session.user as any).permissoes = token.permissoes;
      return session;
    },
  },
});

export interface PortalSession {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    clienteId: string;
    clienteNome: string;
    empresaId: string;
    permissoes: Record<string, boolean>;
  };
}

/** Lê a sessão do portal de forma tipada. */
export async function getPortalSession(): Promise<PortalSession | null> {
  const s = await portalAuth();
  return (s as unknown as PortalSession) ?? null;
}

export function temPermissao(sessao: PortalSession | null, chave: string): boolean {
  return !!sessao?.user?.permissoes?.[chave];
}
