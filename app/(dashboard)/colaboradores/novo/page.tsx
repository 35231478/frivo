import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { ColaboradorForm } from "@/components/forms/colaborador-form";

export const metadata: Metadata = { title: "Novo colaborador" };

export default async function NovoColaboradorPage() {
  const session = await auth();
  if (!pode(session?.user?.permissoes, "equipes", "gerenciar", session?.user?.role)) redirect("/colaboradores");
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Novo colaborador" description="Cadastre um colaborador da equipe" backHref="/colaboradores" />
      <ProtegerSaida><ColaboradorForm podeFolha={pode(session?.user?.permissoes, "financeiro", "folha", session?.user?.role)} /></ProtegerSaida>
    </div>
  );
}
