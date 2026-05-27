import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { EquipamentoForm } from "@/components/forms/equipamento-form";

export const metadata: Metadata = { title: "Editar Equipamento" };

export default async function EditarEquipamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const equipamento = await prisma.equipamento.findFirst({
    where: { id, empresaId },
    include: {
      unidade: {
        include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
      },
    },
  });
  if (!equipamento) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Editar equipamento"
        description={`${equipamento.marca} ${equipamento.modelo}`}
        backHref="/equipamentos"
      />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <EquipamentoForm initialData={equipamento} />
      </div>
    </div>
  );
}
