import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { AuthSessionProvider } from "@/components/providers/session-provider";
import { AppTecnico } from "@/components/tecnico/app-tecnico";

export const metadata: Metadata = { title: "Meu dia" };

const ROLE_LABELS: Record<string, string> = { ADMIN: "Administrador", GESTOR: "Gestor", TECNICO: "Técnico", OPERADOR: "Operador" };

/**
 * App do técnico (PWA). Uma página só: Meu dia, Agenda, Perfil e a execução da OS são vistas dela
 * (escolhidas pela query), então a cópia guardada pelo service worker abre qualquer uma sem sinal.
 */
export default async function TecnicoPage() {
  const session = await auth();
  if (!session) redirect("/sessao-encerrada");
  const u = session.user;
  if (!pode(u.permissoes, "ordens", "visualizar", u.role)) redirect("/sem-permissao");
  const db = await prisma.usuario.findUnique({ where: { id: u.id }, select: { avatar: true } });
  return (
    <AuthSessionProvider session={session}>
      <AppTecnico
        usuario={{
          id: u.id, nome: u.name ?? "", email: u.email ?? "", empresaNome: u.empresaNome ?? "",
          podeGravar: pode(u.permissoes, "ordens", "editar", u.role) || pode(u.permissoes, "ordens", "concluir", u.role),
        }}
        perfilInicial={{
          nome: u.name ?? "", email: u.email ?? "", avatar: db?.avatar ?? null, empresaNome: u.empresaNome ?? "",
          perfilNome: u.perfilNome ?? null, cargo: ROLE_LABELS[u.role] ?? u.role,
        }}
      />
    </AuthSessionProvider>
  );
}
