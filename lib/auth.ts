import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations";
import { authConfig } from "@/auth.config";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, senha } = parsed.data;

        const usuario = await prisma.usuario.findFirst({
          where: { email, ativo: true },
          include: {
            empresa: { select: { id: true, nomeFantasia: true, plano: true, ativo: true } },
            perfilAcesso: { select: { nome: true, permissoes: true } },
          },
        });

        if (!usuario || !usuario.empresa.ativo) return null;

        const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
        if (!senhaCorreta) return null;

        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { ultimoAcesso: new Date() },
        });

        // Administrador master tem acesso total, independente do perfil.
        // Usuário SEM perfil atribuído fica sem restrição (até um admin definir um perfil) —
        // assim a introdução do RBAC não bloqueia usuários existentes.
        const permissoes: Permissoes =
          usuario.role === "ADMIN" || !usuario.perfilAcesso
            ? permissoesTotais()
            : (usuario.perfilAcesso.permissoes as Permissoes);

        return {
          id: usuario.id,
          email: usuario.email,
          name: usuario.nome,
          image: usuario.avatar ?? null,
          empresaId: usuario.empresaId,
          empresaNome: usuario.empresa.nomeFantasia ?? "",
          role: usuario.role,
          permissoes,
          perfilNome: usuario.perfilAcesso?.nome ?? null,
        };
      },
    }),
  ],
});
