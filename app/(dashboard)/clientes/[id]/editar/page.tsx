import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClienteForm } from "@/components/forms/cliente-form";

export const metadata: Metadata = { title: "Editar Cliente" };

export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({
    where: { id, empresaId },
    include: {
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      unidades: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      contatosCliente: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      interacoes: { include: { usuario: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "desc" }, take: 50 },
      _count: { select: { contratos: { where: { status: "ATIVO" } } } },
    },
  });
  if (!cliente) notFound();

  return <ClienteForm initialData={cliente} />;
}
