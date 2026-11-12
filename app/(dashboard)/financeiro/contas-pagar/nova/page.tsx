import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ContaPagarForm } from "@/components/financeiro/conta-pagar-form";

export const metadata: Metadata = { title: "Nova conta a pagar" };

export default function NovaContaPagarPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova conta a pagar" description="Registre uma despesa a pagar" backHref="/financeiro/contas-pagar" />
      <ContaPagarForm />
    </div>
  );
}
