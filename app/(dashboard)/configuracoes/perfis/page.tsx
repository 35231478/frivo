import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { PerfisClient } from "@/components/config/perfis-client";

export const metadata: Metadata = { title: "Perfis de Acesso" };

export default function PerfisPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Perfis de Acesso" description="Controle o que cada colaborador pode ver e fazer no sistema" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <PerfisClient />
      </div>
    </div>
  );
}
