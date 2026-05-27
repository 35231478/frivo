import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EquipamentoForm } from "@/components/forms/equipamento-form";

export const metadata: Metadata = { title: "Novo Equipamento" };

export default async function NovoEquipamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ unidadeId?: string }>;
}) {
  const { unidadeId } = await searchParams;
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Novo equipamento" backHref="/equipamentos" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <EquipamentoForm unidadeIdFixo={unidadeId} />
      </div>
    </div>
  );
}
