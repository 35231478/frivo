import { PageHeader } from "@/components/ui/page-header";
import { CentrosCustoTela } from "@/components/cadastros/telas/centros-custo";

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export function TelaCentrosCusto() {
  return (
    <div>
      <PageHeader title="Centros de custo" description="Onde a despesa pesa: usado em toda conta a pagar e aprendido por fornecedor na nota de compra" backHref="/configuracoes/financeiras" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <CentrosCustoTela />
      </div>
    </div>
  );
}
