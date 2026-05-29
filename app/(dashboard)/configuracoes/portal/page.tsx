import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { PortalConfigClient } from "@/components/config/portal-config-client";
import { CrudCadastro } from "@/components/config/crud-cadastro";

export const metadata: Metadata = { title: "Portal do Cliente" };

export default function ConfigPortalPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title="Portal do Cliente" description="Tipos de problema, aparência e mensagem do portal" backHref="/configuracoes" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-ink mb-4">Aparência e mensagem</h2>
        <PortalConfigClient />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-ink mb-1">Tipos de problema</h2>
        <p className="text-sm text-ink-muted mb-4">Opções que o cliente escolhe ao abrir um chamado pelo portal.</p>
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
