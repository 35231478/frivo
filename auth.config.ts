import type { NextAuthConfig } from "next-auth";

/**
 * Configuração base do Auth.js, segura para o Edge (middleware).
 * NÃO importa provider, bcrypt nem Prisma — só o que o middleware precisa para
 * ler/verificar o JWT da sessão. O provider Credentials (com bcrypt/Prisma) é
 * adicionado apenas no runtime Node em lib/auth.ts.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [], // adicionados em lib/auth.ts (runtime Node)
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.empresaId = (user as any).empresaId;
        token.empresaNome = (user as any).empresaNome;
        token.role = (user as any).role;
        token.permissoes = (user as any).permissoes;
        token.perfilNome = (user as any).perfilNome;
        token.picture = (user as any).image ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      (session.user as any).empresaId = token.empresaId;
      (session.user as any).empresaNome = token.empresaNome;
      (session.user as any).role = token.role;
      (session.user as any).permissoes = token.permissoes ?? {};
      (session.user as any).perfilNome = token.perfilNome ?? null;
      session.user.image = (token.picture as string | null) ?? null;
      return session;
    },
  },
} satisfies NextAuthConfig;
