import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { carregarCentral } from "@/lib/nfse/central-server";
import { NotasCentralView } from "@/components/fiscal/notas-central";

export const metadata: Metadata = { title: "Notas fiscais" };

/**
 * Financeiro › Fiscal › Notas fiscais: a central das NFS-e emitidas (filtro, busca e paginação no
 * servidor, pela URL). Gate: Financeiro › Fiscal — aqui e em cada API das ações.
 */
export default async function NotasFiscaisPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "financeiro", "fiscal", u.role)) redirect("/sem-permissao");
  return <NotasCentralView dados={await carregarCentral(u.empresaId, sp)} />;
}
