import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { ClienteForm } from "@/components/forms/cliente-form";
import { carregarFichaCliente } from "@/lib/clientes/ficha-server";
import { valoresDoCabecalho, veFinanceiroDoCliente } from "@/lib/clientes/cabecalho";
import { pode } from "@/lib/permissoes";

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
  // Os valores do financeiro só saem do servidor para quem vê o financeiro (contas a receber ou faturas)
  const u = session!.user!;
  const valores = valoresDoCabecalho(ficha, veFinanceiroDoCliente((m, a) => pode(u.permissoes, m, a, u.role)));
  return <ClienteForm consulta abaInicial={aba} initialData={ficha.dados} {...valores} perdas12m={ficha.perdas12m} satisfacaoAceite={ficha.satisfacao} />;
}
