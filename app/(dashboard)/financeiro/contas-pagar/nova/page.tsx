import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ContaPagarForm } from "@/components/financeiro/conta-pagar-form";

export const metadata: Metadata = { title: "Nova Conta a Pagar" };

export default function NovaContaPagarPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova Conta a Pagar" description="Registre uma despesa a pagar" backHref="/financeiro/contas-pagar" />
      <ContaPagarForm />
    </div>
  );
}
