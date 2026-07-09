import { PageHeader } from "@/components/ui/page-header";
import { TiposEquipamentoCadastro } from "@/components/config/tipos-equipamento-cadastro";

export default function TiposEquipamentoPage() {
  return (
    <div>
      <PageHeader title="Tipos de Equipamento" description="Categorias de equipamentos e os formulários vinculados a cada tipo de OS" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <TiposEquipamentoCadastro />
      </div>
    </div>
  );
}
