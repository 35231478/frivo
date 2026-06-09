import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EquipamentoForm } from "@/components/forms/equipamento-form";

export const metadata: Metadata = { title: "Editar Equipamento" };

export default async function EditarEquipamentoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const { id } = await params;
  const { aba } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const equipamento = await prisma.equipamento.findFirst({
    where: { id, empresaId },
    include: {
      unidade: {
        include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
      },
      qrcode: { select: { id: true, codigo: true } },
      ordensServico: {
        orderBy: { criadoEm: "desc" },
        take: 30,
        select: {
          id: true, numero: true, status: true, criadoEm: true, dataConclusao: true,
          atividades: { take: 1, select: { tipoOs: { select: { nome: true } }, tecnico: { select: { nome: true } } } },
        },
      },
    },
  });
  if (!equipamento) notFound();

  return (
    <div className="max-w-4xl mx-auto">
      <EquipamentoForm initialData={equipamento} abaInicial={aba} />
    </div>
  );
}
