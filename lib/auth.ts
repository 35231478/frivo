import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations";
import { authConfig } from "@/auth.config";
import { permissoesDoUsuario } from "@/lib/permissoes";
import { conferirTokenAtivo } from "@/lib/sessao-ativa";
import { apagarTentativas, conferirBloqueio, HASH_FICTICIO, ipDaRequisicao, limparTentativas, registrarTentativa } from "@/lib/acesso/limite";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { tecnicoDoUsuario } from "@/lib/tecnico/escopo";

/** Muitas senhas erradas: o formulário recebe o código (com os minutos que faltam), não o motivo. */
class AcessoBloqueado extends CredentialsSignin {
  constructor(minutos: number) {
    super();
    this.code = `bloqueado-${minutos}`;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Só no runtime Node (o middleware Edge usa o authConfig puro): usuário ou empresa
    // inativados perdem a sessão na requisição seguinte, sem esperar o token expirar.
    async jwt(params) {
      const token = authConfig.callbacks.jwt(params);
      return conferirTokenAtivo(token, !!params.user);
    },
  },
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, senha } = parsed.data;
        // "Manter conectado": o formulário manda "true"/"false"; sem o campo, como sempre foi (30 dias)
        const lembrar = (credentials as Record<string, unknown>)?.lembrar !== "false";
        const alvos = { email, ip: ipDaRequisicao(request?.headers) };

        const bloqueio = await conferirBloqueio("LOGIN", alvos);
        if (bloqueio.bloqueado) throw new AcessoBloqueado(bloqueio.minutos);
        // Conta a tentativa ANTES do bcrypt: N requisições em paralelo não furam o limite (S6).
        // Senha certa apaga os registros desta requisição (sucesso não conta contra o IP).
        const registros = await registrarTentativa("LOGIN", alvos);

        const usuario = await prisma.usuario.findFirst({
          where: { email, ativo: true },
          include: {
            empresa: { select: { id: true, nomeFantasia: true, plano: true, ativo: true } },
            perfilAcesso: { select: { nome: true, permissoes: true, ativo: true } },
          },
        });

        const senhaCorreta = await bcrypt.compare(senha, usuario?.senha ?? HASH_FICTICIO);
        if (!usuario || !usuario.empresa.ativo || !senhaCorreta) {
          return null;
        }
        await limparTentativas("LOGIN", alvos);
        await apagarTentativas(registros);

        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { ultimoAcesso: new Date() },
        });

        // ADMIN = acesso total; perfil ativo = permissões do perfil; sem perfil = só o dashboard.
        const permissoes = permissoesDoUsuario(usuario);
        // Técnico ligado a este usuário (mesmo e-mail): liga o modo técnico para o técnico puro
        const tecnico = await tecnicoDoUsuario(usuario.empresaId, usuario.email);

        return {
          id: usuario.id,
          email: usuario.email,
          name: usuario.nome,
          empresaId: usuario.empresaId,
          empresaNome: usuario.empresa.nomeFantasia ?? "",
          role: usuario.role,
          permissoes,
          perfilNome: usuario.perfilAcesso?.ativo === false ? null : usuario.perfilAcesso?.nome ?? null,
          lembrar,
          fs: impressaoDaSenha(usuario.senha),
          tecnicoId: tecnico?.id ?? null,
        };
      },
    }),
  ],
});
