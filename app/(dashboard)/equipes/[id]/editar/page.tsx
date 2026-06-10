import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { EquipeForm } from "@/components/forms/equipe-form";

export const metadata: Metadata = { title: "Editar Equipe" };

export default async function EditarEquipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const equipe = await prisma.equipe.findFirst({
    where: { id, empresaId },
    include: { membros: { select: { id: true, nome: true } }, veiculos: { select: { id: true } } },
  });
  if (!equipe) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Editar Equipe" description={equipe.nome} backHref="/equipes" />
      <EquipeForm initialData={equipe} />
    </div>
  );
}
