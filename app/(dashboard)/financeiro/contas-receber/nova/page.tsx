import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { CobrancaForm } from "@/components/financeiro/cobranca-form";

export const metadata: Metadata = { title: "Nova Cobrança" };

export default function NovaCobrancaPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova Cobrança" description="Crie uma cobrança manual de conta a receber" backHref="/financeiro/contas-receber" />
      <CobrancaForm />
    </div>
  );
}
