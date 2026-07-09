import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { TermoTemplatesClient } from "@/components/config/termo-templates-client";

export const metadata: Metadata = { title: "Termos de Referência" };

export default function TermosConfigPage() {
  return (
    <div>
      <PageHeader title="Termos de Referência" description="Modelos de termo usados nas propostas de contrato, com variáveis automáticas" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <TermoTemplatesClient />
      </div>
    </div>
  );
}
