import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { TecnicoForm } from "@/components/forms/tecnico-form";

export const metadata: Metadata = { title: "Editar Técnico" };

export default async function EditarTecnicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = (session!.user as any).empresaId as string;

  const tecnico = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!tecnico) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Editar técnico" description={tecnico.nome} backHref="/tecnicos" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <TecnicoForm initialData={tecnico} />
      </div>
    </div>
  );
}
