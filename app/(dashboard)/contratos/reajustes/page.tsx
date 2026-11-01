import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { listarReajustes } from "@/lib/contratos/reajuste-server";
import { ReajustesView } from "@/components/contratos/reajustes-view";

export const metadata: Metadata = { title: "Reajustes a aplicar" };

/**
 * "Reajustes a aplicar" (PR4, D8): quem vê e decide é quem edita contrato ("Contratos › Editar").
 * Empresa sempre da sessão.
 */
export default async function ReajustesPage() {
  const session = await auth();
  if (!pode(session!.user!.permissoes, "contratos", "editar", session!.user!.role)) redirect("/sem-permissao");
  const linhas = await listarReajustes(session!.user!.empresaId);
  return <ReajustesView linhas={linhas} />;
}
