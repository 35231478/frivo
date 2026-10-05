import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { ClienteForm } from "@/components/forms/cliente-form";

export const metadata: Metadata = { title: "Novo Cliente" };

export default async function NovoClientePage() {
  const session = await auth();
  // Sem permissão de criar: volta para a listagem (o botão "Novo Cliente" já fica oculto).
  if (!pode(session?.user?.permissoes, "clientes", "criar", session?.user?.role)) redirect("/clientes");
  return <ClienteForm />;
}
