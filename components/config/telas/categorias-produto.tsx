import { PageHeader } from "@/components/ui/page-header";
import { CategoriasProdutoTela } from "@/components/cadastros/telas/categorias-produto";

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export function TelaCategoriasProduto() {
  return (
    <div>
      <PageHeader title="Categorias de produto" description="Como cada tipo de produto entra na cobrança: venda à parte ou incluso no serviço" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <CategoriasProdutoTela />
      </div>
    </div>
  );
}
