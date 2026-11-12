import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { AuthSessionProvider } from "@/components/providers/session-provider";
import { PermissoesProvider } from "@/components/providers/permissoes-provider";
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
  const [db, colaborador, configApp] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: u.id }, select: { avatar: true } }),
    // A foto do cadastro do colaborador (posta pelo escritório) vale quando ele ainda não escolheu a dele
    u.tecnicoId ? prisma.tecnico.findFirst({ where: { id: u.tecnicoId, empresaId: u.empresaId }, select: { avatar: true } }) : null,
    carregarConfigApp(u.empresaId),
  ]);
  // Foto de perfil: a de "Meus dados"; sem ela, a do cadastro do colaborador; sem nenhuma, o app mostra as iniciais
  const avatar = db?.avatar || colaborador?.avatar || null;
  return (
    <AuthSessionProvider session={session}>
      {/* Fora do layout do painel: as permissões da tela (ex.: "concluir sem equipamento") vêm daqui */}
      <PermissoesProvider role={u.role} permissoes={u.permissoes}>
        <AppTecnico
          config={configApp}
          usuario={{
            id: u.id, nome: u.name ?? "", email: u.email ?? "", empresaNome: u.empresaNome ?? "",
            podeGravar: pode(u.permissoes, "ordens", "editar", u.role) || pode(u.permissoes, "ordens", "concluir", u.role),
            avatar,
          }}
          perfilInicial={{
            nome: u.name ?? "", email: u.email ?? "", avatar: null /* vem do contexto do app (uma cópia só da foto na página) */, empresaNome: u.empresaNome ?? "",
            perfilNome: u.perfilNome ?? null, cargo: ROLE_LABELS[u.role] ?? u.role,
          }}
        />
      </PermissoesProvider>
    </AuthSessionProvider>
  );
}
