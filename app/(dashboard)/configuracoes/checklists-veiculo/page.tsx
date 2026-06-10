import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistTemplatesClient } from "@/components/config/checklist-templates-client";

export const metadata: Metadata = { title: "Checklists de Veículo" };

export default function ChecklistsVeiculoPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Checklists de Veículo" description="Crie os modelos de checklist preenchidos pelos colaboradores" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ChecklistTemplatesClient />
      </div>
    </div>
  );
}
