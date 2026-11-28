import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { redirect } from "next/navigation";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { pode } from "@/lib/permissoes";
import { EquipamentoForm } from "@/components/forms/equipamento-form";

export const metadata: Metadata = { title: "Novo equipamento" };

export default async function NovoEquipamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ unidadeId?: string }>;
}) {
  const { unidadeId } = await searchParams;
  const session = await exigirModuloNaPagina("equipamentos");
  // Sem permissão de criar: volta para a listagem (o botão "Novo" já fica oculto).
  if (!pode(session?.user?.permissoes, "equipamentos", "criar", session?.user?.role)) redirect("/equipamentos");
  return (
    <div className="max-w-4xl mx-auto">
      <ProtegerSaida><EquipamentoForm unidadeIdFixo={unidadeId} /></ProtegerSaida>
    </div>
  );
}
