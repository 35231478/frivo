import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PerfilClient } from "@/components/perfil/perfil-client";

export const metadata: Metadata = { title: "Meu Perfil" };

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  TECNICO: "Técnico",
  OPERADOR: "Operador",
};

export default async function PerfilPage() {
  const session = await auth();
  const u = session!.user;
  const db = await prisma.usuario.findUnique({ where: { id: u.id }, select: { avatar: true } });

  return (
    <PerfilClient
      initial={{
        nome: u.name ?? "",
        email: u.email ?? "",
        avatar: db?.avatar ?? null,
        empresaNome: (u as any).empresaNome ?? "",
        perfilNome: (u as any).perfilNome ?? null,
        cargo: ROLE_LABELS[u.role] ?? u.role,
      }}
    />
  );
}
