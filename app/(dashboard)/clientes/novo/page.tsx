import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ClienteForm } from "@/components/forms/cliente-form";

export const metadata: Metadata = { title: "Novo Cliente" };

export default function NovoClientePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Novo cliente" backHref="/clientes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ClienteForm />
      </div>
    </div>
  );
}
