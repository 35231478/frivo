import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { ClienteForm } from "@/components/forms/cliente-form";
import { carregarFichaCliente } from "@/lib/clientes/ficha-server";

export const metadata: Metadata = { title: "Cliente" };

/**
 * A FICHA do cliente em modo consulta — é para onde a lista, a busca e os atalhos levam. O cadastro aparece
 * como texto; "Editar" é uma ação do cabeçalho (/clientes/[id]/editar). Mesmas abas da edição.
 */
export default async function ClienteFichaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const { id } = await params;
  const { aba } = await searchParams;
  const session = await auth();
  const ficha = await carregarFichaCliente(id, session!.user!.empresaId);
  if (!ficha) notFound();
  return <ClienteForm consulta abaInicial={aba} initialData={ficha.dados} statusFinanceiroCalc={ficha.status} totalProximos30Dias={ficha.totalProximos30Dias} perdas12m={ficha.perdas12m} satisfacaoAceite={ficha.satisfacao} />;
}
