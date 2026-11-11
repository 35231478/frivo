import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { AppColaboradorClient } from "@/components/equipes/app-colaborador-client";

export const metadata: Metadata = { title: "App do colaborador" };

/**
 * App do colaborador: as permissões/autorizações do app do técnico, por empresa (global, igual para
 * todos os colaboradores). Só quem configura (Configurações › gerenciar) edita — o técnico nunca vê
 * esta tela (o modo técnico o confina ao /tecnico). Multiempresa: tudo por empresaId.
 */
export default async function AppColaboradorPage() {
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "configuracoes", "gerenciar", u.role)) redirect("/sem-permissao");
  const config = await carregarConfigApp(u.empresaId);
  return <AppColaboradorClient inicial={config} />;
}
