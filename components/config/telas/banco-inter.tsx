import { PageHeader } from "@/components/ui/page-header";
import { InterConfigClient } from "@/components/config/inter-config-client";

export function TelaBancoInter() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Banco Inter" description="Boletos e baixa automática de pagamentos" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-6">
        <InterConfigClient />
      </div>
    </div>
  );
}
