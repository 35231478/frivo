import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { ContratoForm } from "@/components/forms/contrato-form";
import { FileSignature, ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "Editar Contrato" };

export default async function EditarContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const contrato = await prisma.contrato.findFirst({
    where: { id, empresaId },
    include: {
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      origemOrcamento: { select: { id: true, codigo: true } },
      unidades: {
        include: { unidade: true },
      },
    },
  });
  if (!contrato) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Editar contrato" description={contrato.numero} backHref="/contratos" />
      {contrato.origemOrcamento && (
        <Link href={`/orcamentos/${contrato.origemOrcamento.id}`}
          className="mb-4 bg-success-50 border border-success-500/40 text-success-700 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm font-semibold hover:bg-success-100 transition-colors">
          <FileSignature className="w-4 h-4 shrink-0" /> Originado da proposta {contrato.origemOrcamento.codigo}
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      )}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ContratoForm initialData={contrato} />
      </div>
    </div>
  );
}
