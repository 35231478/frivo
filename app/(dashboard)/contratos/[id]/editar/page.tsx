import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
      unidades: { include: { unidade: true } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, categoria: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      reajustes: { orderBy: { data: "desc" } },
      historicoStatus: { include: { usuario: { select: { id: true, nome: true } } }, orderBy: { createdAt: "desc" } },
      recorrenciasLocais: true,
    },
  });
  if (!contrato) notFound();

  return <ContratoForm initialData={contrato} />;
}
