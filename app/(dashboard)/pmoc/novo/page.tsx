import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PmocEditor } from "@/components/pmoc/pmoc-editor";
import { configPmoc } from "@/lib/pmoc-documento-server";

export const metadata: Metadata = { title: "Novo PMOC" };

export default async function NovoPmocPage() {
  const session = await auth();
  if (!pode(session?.user?.permissoes, "pmoc", "criar", session?.user?.role)) redirect("/pmoc");
  // O plano novo nasce com o texto técnico padrão DESTA empresa (ou o do sistema, se ela não tiver o seu)
  const config = await configPmoc(session!.user!.empresaId);
  return <div className="max-w-5xl mx-auto"><PmocEditor config={config} /></div>;
}
