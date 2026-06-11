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
  }
}
