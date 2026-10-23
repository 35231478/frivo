import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { OrcamentoForm } from "@/components/forms/orcamento-form";
import { dadosNovoOrcamento } from "@/lib/orcamentos/form-dados";

export const metadata: Metadata = { title: "Novo Orçamento" };

export default async function NovoOrcamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ clienteId?: string; osId?: string }>;
}) {
  const { clienteId, osId } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  return <OrcamentoForm mode="novo" {...await dadosNovoOrcamento(empresaId, { clienteId, osId })} />;
}
