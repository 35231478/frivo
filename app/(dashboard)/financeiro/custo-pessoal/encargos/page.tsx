import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { ModelosEncargosTela } from "@/components/cadastros/telas/modelos-encargos";
import { Info } from "lucide-react";

export const metadata: Metadata = { title: "Modelos de encargos" };

export default async function ModelosEncargosPage() {
  const session = await auth();
  const user = session!.user!;
  if (!pode(user.permissoes, "financeiro", "folha", user.role)) redirect("/sem-permissao");

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <PageHeader title="Modelos de encargos" description="Percentuais por tipo de contrato, aplicados sobre salário + adicionais + horas extras" backHref="/financeiro/custo-pessoal" />
      <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs sm:text-sm text-amber-800">
        <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <p>
          Os valores iniciais são <strong>referência</strong> para empresa do regime geral (Lucro Presumido/Real). No Simples Nacional, por exemplo,
          o INSS patronal costuma não incidir (Anexo III). <strong>Ajuste com o seu contador.</strong> Estimativa de gestão — não substitui a folha oficial.
        </p>
      </div>
      {/* Cadastro padronizado (lib/cadastros): os modelos padrão são criados na primeira listagem */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <ModelosEncargosTela />
      </div>
    </div>
  );
}
