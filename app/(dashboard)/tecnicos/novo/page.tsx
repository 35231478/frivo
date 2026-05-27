import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { TecnicoForm } from "@/components/forms/tecnico-form";

export const metadata: Metadata = { title: "Novo Técnico" };

export default function NovoTecnicoPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Novo técnico" backHref="/tecnicos" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <TecnicoForm />
      </div>
    </div>
  );
}
