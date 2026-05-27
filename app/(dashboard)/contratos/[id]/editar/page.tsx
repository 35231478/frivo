import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { ContratoForm } from "@/components/forms/contrato-form";

export const metadata: Metadata = { title: "Editar Contrato" };

export default async function EditarContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const contrato = await prisma.contrato.findFirst({
    where: { id, empresaId },
    include: {
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      unidades: {
        include: { unidade: true },
      },
    },
  });
  if (!contrato) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Editar contrato" description={contrato.numero} backHref="/contratos" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ContratoForm initialData={contrato} />
      </div>
    </div>
  );
}
