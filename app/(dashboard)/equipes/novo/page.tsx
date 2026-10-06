import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { EquipeForm } from "@/components/forms/equipe-form";

export const metadata: Metadata = { title: "Nova Equipe" };

export default async function NovaEquipePage() {
  const session = await auth();
  if (!pode(session?.user?.permissoes, "equipes", "gerenciar", session?.user?.role)) redirect("/equipes");
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova Equipe" description="Monte uma equipe de campo" backHref="/equipes" />
      <EquipeForm />
    </div>
  );
}
