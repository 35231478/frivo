import type { Metadata } from "next";
import { EquipamentoForm } from "@/components/forms/equipamento-form";

export const metadata: Metadata = { title: "Novo Equipamento" };

export default async function NovoEquipamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ unidadeId?: string }>;
}) {
  const { unidadeId } = await searchParams;
  return (
    <div className="max-w-4xl mx-auto">
      <EquipamentoForm unidadeIdFixo={unidadeId} />
    </div>
  );
}
