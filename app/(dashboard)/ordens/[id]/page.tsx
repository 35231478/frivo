import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OsDetalhe } from "@/components/os/os-detalhe";

export const metadata: Metadata = { title: "Ordem de Serviço" };

export default async function OsDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      unidade: { select: { id: true, nome: true, cidade: true, estado: true } },
      contrato: { select: { id: true, numero: true } },
      responsavel: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      atividades: {
        include: {
          tipoOs: { select: { id: true, nome: true, cor: true } },
          tecnico: { select: { id: true, nome: true } },
          respostas: { include: { campo: true } },
        },
        orderBy: { criadoEm: "asc" },
      },
      itensOrcamento: true,
      medicoes: { include: { itensFinanceiro: true }, orderBy: { numero: "asc" } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      historico: { include: { usuario: { select: { nome: true } } }, orderBy: { criadoEm: "desc" } },
    },
  });
  if (!os) notFound();

  return <OsDetalhe os={os} />;
}
