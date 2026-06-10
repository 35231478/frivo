import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { VeiculoForm } from "@/components/forms/veiculo-form";

export const metadata: Metadata = { title: "Novo Veículo" };

export default function NovoVeiculoPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Novo Veículo" description="Cadastre um veículo da frota" backHref="/veiculos" />
      <VeiculoForm />
    </div>
  );
}
