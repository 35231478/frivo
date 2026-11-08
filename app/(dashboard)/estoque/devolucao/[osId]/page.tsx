import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { separacaoDaOs } from "@/lib/estoque/separacao-server";
import { DevolucaoOs } from "@/components/estoque/devolucao-os";

export const metadata: Metadata = { title: "Devolver material" };
export const dynamic = "force-dynamic";

/** Estoque › A devolver › OS (E4.3): devolver ao estoque a sobra (ou o reservado da OS cancelada). */
export default async function DevolucaoOsPage({ params }: { params: Promise<{ osId: string }> }) {
  const [{ osId }, session] = await Promise.all([params, auth()]);
  const u = session!.user!;
  if (!pode(u.permissoes, "estoque", "separar", u.role)) redirect("/sem-permissao");
  const dados = await separacaoDaOs(u.empresaId, osId);
  if (!dados) notFound();
  return <DevolucaoOs inicial={dados} />;
}
