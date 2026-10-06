import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { UsuariosClient } from "@/components/config/usuarios-client";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsuariosPage() {
  const session = await auth();
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Usuários" description="Vincule os usuários do sistema aos perfis de acesso" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <UsuariosClient usuarioAtualId={session?.user?.id ?? ""} />
      </div>
    </div>
  );
}
