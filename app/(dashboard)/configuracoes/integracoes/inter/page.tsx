import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { InterConfigClient } from "@/components/config/inter-config-client";

export const metadata: Metadata = { title: "Banco Inter" };

export default function InterIntegracaoPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Integração — Banco Inter" description="Emissão de boletos e baixa automática de pagamentos" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <InterConfigClient />
      </div>
    </div>
  );
}
