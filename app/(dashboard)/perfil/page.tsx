import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { PerfilSair } from "@/components/perfil/perfil-sair";

export const metadata: Metadata = { title: "Meu Perfil" };

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  TECNICO: "Técnico",
  OPERADOR: "Operador",
};

export default async function PerfilPage() {
  const session = await auth();
  const u = session!.user;
  const iniciais = u.name?.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() ?? "??";
  const cargo = ROLE_LABELS[u.role] ?? u.role;

  const campos: { label: string; valor?: string | null }[] = [
    { label: "Nome", valor: u.name },
    { label: "E-mail", valor: u.email },
    { label: "Empresa", valor: (u as any).empresaNome },
    { label: "Perfil de acesso", valor: (u as any).perfilNome ?? cargo },
    { label: "Função", valor: cargo },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Meu Perfil" description="Suas informações de acesso" backHref="/dashboard" />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Cabeçalho com avatar */}
        <div className="flex items-center gap-4 p-6 border-b border-gray-100 bg-gradient-to-r from-primary-50/60 to-transparent">
          {u.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.image} alt={u.name ?? "Usuário"} className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <span className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-xl font-bold">
              {iniciais}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{u.name ?? "Usuário"}</h2>
            <p className="text-sm text-gray-500 truncate">{u.email}</p>
          </div>
        </div>

        {/* Dados */}
        <dl className="divide-y divide-gray-50">
          {campos.filter((c) => c.valor).map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-4 px-6 py-3">
              <dt className="text-sm text-gray-500">{c.label}</dt>
              <dd className="text-sm font-medium text-gray-900 text-right truncate">{c.valor}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <p className="text-xs text-gray-400">Para alterar dados de acesso, contate um administrador em Configurações › Usuários.</p>
          <PerfilSair />
        </div>
      </div>
    </div>
  );
}
