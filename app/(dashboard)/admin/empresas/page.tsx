import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ehDonoDoFrivo } from "@/lib/anotacoes/dono";
import { listarEmpresas } from "@/lib/empresa/criar-empresa";
import { EmpresasAdmin } from "@/components/admin/empresas-admin";

export const metadata: Metadata = { title: "Empresas" };

/** Área do dono do Frivo: as empresas cadastradas e "Nova empresa" (só SUPER_ADMIN; a API também recusa). */
export default async function EmpresasAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!ehDonoDoFrivo(session.user)) redirect("/sem-permissao");
  return <EmpresasAdmin inicial={await listarEmpresas()} />;
}
