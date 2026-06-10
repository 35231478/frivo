import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EquipeForm } from "@/components/forms/equipe-form";

export const metadata: Metadata = { title: "Nova Equipe" };

export default function NovaEquipePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova Equipe" description="Monte uma equipe de campo" backHref="/equipes" />
      <EquipeForm />
    </div>
  );
}
