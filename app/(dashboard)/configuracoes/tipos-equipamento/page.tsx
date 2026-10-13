import { PageHeader } from "@/components/ui/page-header";
import { TiposEquipamentoTela } from "@/components/cadastros/telas/tipos-equipamento";

export default function TiposEquipamentoPage() {
  return (
    <div>
      <PageHeader title="Tipos de Equipamento" description="Categorias de equipamentos e os formulários vinculados a cada tipo de OS" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, impacto, ações em massa */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <TiposEquipamentoTela />
      </div>
    </div>
  );
}
