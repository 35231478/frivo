import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { PrazoTemplatesClient } from "@/components/config/prazo-templates-client";

export const metadata: Metadata = { title: "Prazos e SLA" };

export default function PrazosConfigPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Prazos e SLA" description="Modelos de prazo com etapas, responsáveis e notificações" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <PrazoTemplatesClient />
      </div>
    </div>
  );
}
