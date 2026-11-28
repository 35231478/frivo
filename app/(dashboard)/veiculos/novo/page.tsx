import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { pode } from "@/lib/permissoes";
import { VeiculoForm } from "@/components/forms/veiculo-form";

export const metadata: Metadata = { title: "Novo veículo" };

export default async function NovoVeiculoPage() {
  // Módulo da empresa (entitlement): desligado, a rota redireciona — acima do RBAC do usuário
  const session = await exigirModuloNaPagina("veiculos");
  // Cadastrar veículo (inclusive pela foto do CRLV) exige "veiculos.gerenciar"
  if (!pode(session?.user?.permissoes, "veiculos", "gerenciar", session?.user?.role)) redirect("/veiculos");
  return (
    <div className="max-w-5xl mx-auto">
      <ProtegerSaida><VeiculoForm /></ProtegerSaida>
    </div>
  );
}
