import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { CentrosCustoTela } from "@/components/cadastros/telas/centros-custo";

export const metadata: Metadata = { title: "Centros de custo" };

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export default function CentrosCustoPage() {
  return (
    <div>
      <PageHeader title="Centros de custo" description="Onde a despesa pesa: usado em toda conta a pagar e aprendido por fornecedor na nota de compra" backHref="/configuracoes/financeiras" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <CentrosCustoTela />
      </div>
    </div>
  );
}
