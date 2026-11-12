import { PageHeader } from "@/components/ui/page-header";
import { PerfisAcessoTela } from "@/components/cadastros/telas/perfis-acesso";

/** Cadastro padronizado (lib/cadastros): regras e travas em lib/cadastros/especificos.ts. */
export function TelaPerfis() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Perfis de acesso" description="Permissões de cada perfil no sistema" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <PerfisAcessoTela />
      </div>
    </div>
  );
}
