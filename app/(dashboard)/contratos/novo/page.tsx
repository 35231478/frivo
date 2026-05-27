import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ContratoForm } from "@/components/forms/contrato-form";

export const metadata: Metadata = { title: "Novo Contrato" };

export default function NovoContratoPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Novo contrato" backHref="/contratos" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ContratoForm />
      </div>
    </div>
  );
}
