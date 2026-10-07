import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { UsuariosTela } from "@/components/cadastros/telas/usuarios";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "Usuários" };

/** Cadastro padronizado (lib/cadastros): travas de acesso em lib/cadastros/especificos.ts. */
export default async function UsuariosPage() {
  const session = await auth();
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Usuários" description="Quem faz login no sistema e com qual perfil de acesso" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <UsuariosTela usuarioAtualId={session?.user?.id ?? ""} />
      </div>
    </div>
  );
}
