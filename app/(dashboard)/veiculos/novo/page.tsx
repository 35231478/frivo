import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { VeiculoForm } from "@/components/forms/veiculo-form";

export const metadata: Metadata = { title: "Novo Veículo" };

export default async function NovoVeiculoPage() {
  const session = await auth();
  // Cadastrar veículo (inclusive pela foto do CRLV) exige "veiculos.gerenciar"
  if (!pode(session?.user?.permissoes, "veiculos", "gerenciar", session?.user?.role)) redirect("/veiculos");
  return (
    <div className="max-w-5xl mx-auto">
      <VeiculoForm />
    </div>
  );
}
