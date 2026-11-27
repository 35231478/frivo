import "next-auth";
import type { Role } from "@prisma/client";
import type { Permissoes } from "@/lib/permissoes";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      empresaId: string;
      empresaNome: string;
      role: Role;
      permissoes: Permissoes;
      perfilNome?: string | null;
      /** Técnico ligado ao usuário (mesmo e-mail), gravado no login */
      tecnicoId?: string | null;
      /** O cookie desta requisição trazia papel/permissões diferentes do cadastro atual */
      acessoMudou?: boolean;
      /** Senha definida por outra pessoa: só a tela de troca abre até trocar (lib/acesso/troca-obrigatoria) */
      trocarSenha?: boolean;
    };
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    empresaId: string;
    empresaNome: string;
    role: Role;
    permissoes?: Permissoes;
    perfilNome?: string | null;
    /** "Manter conectado" marcado no login */
    lembrar?: boolean;
    /** Impressão da senha no login (lib/acesso/impressao-senha) */
    fs?: string;
    tecnicoId?: string | null;
    /** Nonce do dispositivo ativo ("apenas um dispositivo ativo"): novo login desconecta o anterior */
    sessaoAtiva?: string | null;
    /** Senha definida por outra pessoa e ainda não trocada (usuarios.trocar_senha) */
    trocarSenha?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    empresaId: string;
    empresaNome: string;
    role: Role;
    permissoes?: Permissoes;
    perfilNome?: string | null;
    /** "Manter conectado": false = sessão de 1 dia desde `loginEm` (ms) */
    lembrar?: boolean;
    loginEm?: number;
    /** Impressão da senha no login: senha trocada depois → sessão encerrada */
    fs?: string;
    /** Técnico ligado ao usuário (modo técnico) */
    tecnicoId?: string | null;
    /** Nonce do dispositivo ("apenas um dispositivo ativo"): não bate com o do banco → sessão encerrada */
    sa?: string | null;
    /** Troca de senha pendente (lib/acesso/troca-obrigatoria) */
    trocarSenha?: boolean;
  }
}
