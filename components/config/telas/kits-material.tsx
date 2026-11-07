import { PageHeader } from "@/components/ui/page-header";
import { KitsMaterialTela } from "@/components/cadastros/telas/kits-material";

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export function TelaKitsMaterial() {
  return (
    <div>
      <PageHeader title="Kits de material" description="Conjuntos de produtos com quantidade, reutilizados nos materiais padrão dos serviços" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <KitsMaterialTela />
      </div>
    </div>
  );
}
