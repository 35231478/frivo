import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { separacaoDaOs } from "@/lib/estoque/separacao-server";
import { SeparacaoOs } from "@/components/estoque/separacao-os";

export const metadata: Metadata = { title: "Separar material" };
export const dynamic = "force-dynamic";

/** Estoque › A separar › OS (E4.1): a tela de separação de uma OS (quem tem "Estoque › Separar material"). */
export default async function SeparacaoOsPage({ params }: { params: Promise<{ osId: string }> }) {
  const [{ osId }, session] = await Promise.all([params, auth()]);
  const u = session!.user!;
  if (!pode(u.permissoes, "estoque", "separar", u.role)) redirect("/sem-permissao");
  const dados = await separacaoDaOs(u.empresaId, osId);
  if (!dados) notFound();
  return <SeparacaoOs inicial={dados} />;
}
