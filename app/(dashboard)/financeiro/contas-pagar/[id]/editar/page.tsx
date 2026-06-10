import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { ContaPagarForm } from "@/components/financeiro/conta-pagar-form";

export const metadata: Metadata = { title: "Editar Conta a Pagar" };

export default async function EditarContaPagarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const conta = await prisma.contaPagar.findFirst({ where: { id, empresaId } });
  if (!conta) notFound();

  const initialData = {
    ...conta,
    valorTotal: Number(conta.valorTotal),
    dataVencimento: conta.dataVencimento ? conta.dataVencimento.toISOString() : null,
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title={`Editar ${conta.numero}`} description={conta.fornecedor} backHref="/financeiro/contas-pagar" />
      <ContaPagarForm initialData={initialData} />
    </div>
  );
}
