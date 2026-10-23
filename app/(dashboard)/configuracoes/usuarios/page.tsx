import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { UsuariosTela } from "@/components/cadastros/telas/usuarios";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Usuários" };

/** Cadastro padronizado (lib/cadastros): travas de acesso em lib/cadastros/especificos.ts. */
export default async function UsuariosPage() {
  const session = await auth();
  // Y11: o app do técnico liga usuário ↔ técnico pelo E-MAIL (lib/tecnico/escopo.ts). Um usuário
  // com papel Técnico sem técnico ativo nesse e-mail cai no sistema comum "vazio" — a tela avisa.
  const tecnicos = session?.user?.empresaId
    ? await prisma.tecnico.findMany({ where: { empresaId: session.user.empresaId, ativo: true, email: { not: null } }, select: { email: true } })
    : [];
  const emailsTecnicos = tecnicos.map((t) => t.email!.trim().toLowerCase()).filter(Boolean);
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Usuários" description="Quem faz login no sistema e com qual perfil de acesso" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <UsuariosTela usuarioAtualId={session?.user?.id ?? ""} emailsTecnicos={emailsTecnicos} />
      </div>
    </div>
  );
}
