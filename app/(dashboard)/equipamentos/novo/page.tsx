import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { EquipamentoForm } from "@/components/forms/equipamento-form";

export const metadata: Metadata = { title: "Novo Equipamento" };

export default async function NovoEquipamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ unidadeId?: string }>;
}) {
  const { unidadeId } = await searchParams;
  const session = await auth();
  // Sem permissão de criar: volta para a listagem (o botão "Novo" já fica oculto).
  if (!pode(session?.user?.permissoes, "equipamentos", "criar", session?.user?.role)) redirect("/equipamentos");
  return (
    <div className="max-w-4xl mx-auto">
      <EquipamentoForm unidadeIdFixo={unidadeId} />
    </div>
  );
}
