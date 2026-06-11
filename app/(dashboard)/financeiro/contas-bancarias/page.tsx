import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Landmark, ArrowRight, Building2 } from "lucide-react";

export const metadata: Metadata = { title: "Contas Bancárias" };

export default function ContasBancariasPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Contas Bancárias"
        description="Gerencie as contas e integrações bancárias da empresa"
        backHref="/financeiro"
      />

      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-4">
          <Landmark className="w-7 h-7 text-primary-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Em breve</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
          O cadastro de contas bancárias está em construção. Por enquanto, configure aqui a
          integração com o Banco Inter para emissão de boletos.
        </p>

        <Link
          href="/configuracoes/integracoes/inter"
          className="inline-flex items-center gap-2 mt-6 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Building2 className="w-4 h-4" /> Integração Banco Inter <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
