import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, senha } = parsed.data;

        const usuario = await prisma.usuario.findFirst({
          where: { email, ativo: true },
          include: { empresa: { select: { id: true, nomeFantasia: true, plano: true, ativo: true } } },
        });

        if (!usuario || !usuario.empresa.ativo) return null;

        const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
        if (!senhaCorreta) return null;

        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { ultimoAcesso: new Date() },
        });

        return {
          id: usuario.id,
          email: usuario.email,
          name: usuario.nome,
          empresaId: usuario.empresaId,
          empresaNome: usuario.empresa.nomeFantasia ?? "",
          role: usuario.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.empresaId = (user as any).empresaId;
        token.empresaNome = (user as any).empresaNome;
        token.role = (user as any).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      (session.user as any).empresaId = token.empresaId;
      (session.user as any).empresaNome = token.empresaNome;
      (session.user as any).role = token.role;
      return session;
    },
  },
});
