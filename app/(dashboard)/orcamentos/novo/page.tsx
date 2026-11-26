import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { OrcamentoForm } from "@/components/forms/orcamento-form";
import { dadosNovoOrcamento } from "@/lib/orcamentos/form-dados";

export const metadata: Metadata = { title: "Novo orçamento" };

export default async function NovoOrcamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ clienteId?: string; osId?: string }>;
}) {
  const { clienteId, osId } = await searchParams;
  const session = await auth();
  // Sem permissão de criar: volta para a lista (o botão "Novo orçamento" já fica oculto; a API também recusa)
  if (!pode(session?.user?.permissoes, "orcamentos", "criar", session?.user?.role)) redirect("/orcamentos");
  const empresaId = session!.user!.empresaId;

  return <OrcamentoForm mode="novo" {...await dadosNovoOrcamento(empresaId, { clienteId, osId })} />;
}
