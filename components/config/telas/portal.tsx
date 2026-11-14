import { PageHeader } from "@/components/ui/page-header";
import { PortalConfigClient } from "@/components/config/portal-config-client";
import { TiposProblemaTela } from "@/components/cadastros/telas/tipos-problema";

export function TelaPortal() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title="Portal do cliente" description="Tipos de problema, aparência e mensagem" backHref="/configuracoes" />

      <div className="bg-white rounded-card border border-surface-border p-6">
        <h2 className="text-base font-semibold text-ink mb-4">Aparência e mensagem</h2>
        <PortalConfigClient />
      </div>

      {/* Cadastro padronizado (lib/cadastros): abas, busca, permissão nos botões e cartões no celular; a explicação fica no ⓘ */}
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6" data-secao-tipos-problema>
        <h2 className="text-base font-semibold text-ink mb-4">Tipos de problema</h2>
        <TiposProblemaTela />
      </div>
    </div>
  );
}
