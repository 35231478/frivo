import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { PerfisAcessoTela } from "@/components/cadastros/telas/perfis-acesso";

export const metadata: Metadata = { title: "Perfis de Acesso" };

/** Cadastro padronizado (lib/cadastros): regras e travas em lib/cadastros/especificos.ts. */
export default function PerfisPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Perfis de Acesso" description="Controle o que cada colaborador pode ver e fazer no sistema" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <PerfisAcessoTela />
      </div>
    </div>
  );
}
