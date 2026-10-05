import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { CadastroPorFoto } from "@/components/equipamentos/cadastro-por-foto";

export const metadata: Metadata = { title: "Cadastro pela foto" };

export default async function CadastroPorFotoPage() {
  const session = await auth();
  // Mesma regra do cadastro manual (o servidor também valida a leitura e o salvamento)
  if (!pode(session?.user?.permissoes, "equipamentos", "criar", session?.user?.role)) redirect("/equipamentos");
  return <CadastroPorFoto />;
}
