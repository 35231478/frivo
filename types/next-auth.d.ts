import "next-auth";
import type { Role } from "@prisma/client";

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
    };
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    empresaId: string;
    empresaNome: string;
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    empresaId: string;
    empresaNome: string;
    role: Role;
  }
}
