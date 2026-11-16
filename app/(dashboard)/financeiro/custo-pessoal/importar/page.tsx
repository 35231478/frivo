import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { ImportarPlanilha } from "@/components/folha/importar-planilha";

export const metadata: Metadata = { title: "Importar colaboradores" };

const AJUDA = "A planilha (CSV ou Excel) grava no mesmo cadastro de Equipes › Colaboradores: o CPF evita duplicar, e as colunas de folha são as mesmas da ficha. Nada é gravado antes da conferência.";

export default async function ImportarColaboradoresPage() {
  const session = await auth();
  if (!pode(session?.user?.permissoes, "financeiro", "folha", session?.user?.role)) redirect("/sem-permissao");
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Importar colaboradores" description="Colaboradores por planilha" dica={AJUDA} backHref="/financeiro/custo-pessoal" />
      <ImportarPlanilha />
    </div>
  );
}
