import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ColaboradorForm } from "@/components/forms/colaborador-form";

export const metadata: Metadata = { title: "Novo Colaborador" };

export default function NovoColaboradorPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Novo Colaborador" description="Cadastre um colaborador da equipe" backHref="/colaboradores" />
      <ColaboradorForm />
    </div>
  );
}
