import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nomeDaEmpresa } from "@/lib/empresa/nome";
import { PerfilClient } from "@/components/perfil/perfil-client";
import { pushLigado } from "@/lib/push/config";

export const metadata: Metadata = { title: "Meu perfil" };

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  TECNICO: "Técnico",
  OPERADOR: "Operador",
};

export default async function PerfilPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const session = await auth();
  const u = session!.user;
  const [db, empresaNome] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: u.id }, select: { avatar: true, telefone: true, ultimoAcesso: true } }),
    nomeDaEmpresa(u.empresaId),
  ]);

  return (
    <PerfilClient
      initial={{
        nome: u.name ?? "",
        email: u.email ?? "",
        avatar: db?.avatar ?? null,
        telefone: db?.telefone ?? null,
        ultimoAcesso: db?.ultimoAcesso?.toISOString() ?? null,
        empresaNome,
        perfilNome: (u as any).perfilNome ?? null,
        cargo: ROLE_LABELS[u.role] ?? u.role,
      }}
      notificacoes={pushLigado()}
      abaNaUrl
      abaPedida={(await searchParams).aba ?? null}
    />
  );
}
