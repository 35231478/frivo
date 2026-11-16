import { PageHeader } from "@/components/ui/page-header";
import { AdmissaoConfigClient } from "@/components/config/admissao-config-client";

/**
 * Configurações › Admissão digital: o que varia entre empresas (modelo de contrato, documentos
 * pedidos, orientações finais, validade do link e período de experiência).
 */
export function TelaAdmissao() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Admissão digital" description="Contrato, documentos e orientações do link do colaborador"
        backHref="/configuracoes"
        dica="O RH manda um link ao colaborador; o que esta tela define é o que o link pede e o que ele mostra no fim. O sistema preenche os campos do contrato, nunca escreve cláusula."
      />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <AdmissaoConfigClient />
      </div>
    </div>
  );
}
