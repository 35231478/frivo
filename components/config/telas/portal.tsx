import { Dica } from "@/components/ui/dica";
import { PageHeader } from "@/components/ui/page-header";
import { PortalConfigClient } from "@/components/config/portal-config-client";
import { CrudCadastro } from "@/components/config/crud-cadastro";

export function TelaPortal() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title="Portal do cliente" description="Tipos de problema, aparência e mensagem" backHref="/configuracoes" />

      <div className="bg-white rounded-card border border-surface-border p-6">
        <h2 className="text-base font-semibold text-ink mb-4">Aparência e mensagem</h2>
        <PortalConfigClient />
      </div>

      <div className="bg-white rounded-card border border-surface-border p-6">
        <h2 className="text-base font-semibold text-ink mb-4 flex items-center gap-1">
          Tipos de problema<Dica texto="Opções exibidas ao cliente na abertura de chamado pelo portal." rotulo="Tipos de problema" lado="direita" />
        </h2>
        <CrudCadastro
          titulo="Tipo de problema"
          apiUrl="/api/tipos-problema"
          campos={[{ key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Ar não gela, Vazamento, Ruído" }]}
          colunasLista={[{ key: "nome", label: "Nome" }]}
        />
      </div>
    </div>
  );
}
