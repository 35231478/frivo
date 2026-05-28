"use client";

import { signOut } from "next-auth/react";
import { Bell, ChevronRight, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import type { Session } from "next-auth";

interface HeaderProps {
  session: Session;
}

const ROTULOS_ROTA: Record<string, string> = {
  dashboard: "Dashboard",
  clientes: "Clientes",
  equipamentos: "Equipamentos",
  ordens: "Ordens de Serviço",
  contratos: "Contratos",
  tecnicos: "Técnicos",
  configuracoes: "Configurações",
  formularios: "Formulários",
  produtos: "Produtos",
  servicos: "Serviços",
  "tipos-equipamento": "Tipos de Equipamento",
  "tipos-os": "Tipos de OS",
  novo: "Novo",
  nova: "Nova",
  editar: "Editar",
};

function gerarBreadcrumb(pathname: string) {
  const segs = pathname.split("/").filter(Boolean);
  const itens: { label: string; href: string }[] = [];
  let acc = "";
  for (const seg of segs) {
    acc += "/" + seg;
    const label =
      ROTULOS_ROTA[seg] ??
      (/^[0-9a-f]{8,}/i.test(seg) ? "Detalhes" : seg.charAt(0).toUpperCase() + seg.slice(1));
    itens.push({ label, href: acc });
  }
  return itens;
}

export function Header({ session }: HeaderProps) {
  const usuario = session.user;
  const pathname = usePathname();
  const breadcrumb = useMemo(() => gerarBreadcrumb(pathname), [pathname]);
  const iniciais =
    usuario.name
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "??";

  return (
    <header className="bg-white border-b border-surface-border shadow-card px-6 py-3 flex items-center justify-between gap-4 shrink-0">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm min-w-0">
        <Link href="/dashboard" className="text-ink-muted hover:text-primary-600 transition-colors">
          {usuario.empresaNome}
        </Link>
        {breadcrumb.map((item, idx) => {
          const isLast = idx === breadcrumb.length - 1;
          return (
            <span key={item.href} className="flex items-center gap-1.5 min-w-0">
              <ChevronRight className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
              {isLast ? (
                <span className="font-semibold text-ink truncate">{item.label}</span>
              ) : (
                <Link
                  href={item.href}
                  className="text-ink-muted hover:text-primary-600 transition-colors truncate"
                >
                  {item.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        {/* Busca global */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
          <input
            type="search"
            placeholder="Buscar..."
            className="w-64 bg-surface-alt border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:bg-white focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
          />
        </div>

        {/* Notificações */}
        <button
          className="relative p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt transition-colors"
          title="Notificações"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-success-500 rounded-full ring-2 ring-white" />
        </button>

        <div className="w-px h-8 bg-surface-border" />

        {/* Avatar / usuário */}
        <div className="flex items-center gap-2.5">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-ink leading-tight">{usuario.name}</p>
            <p className="text-xs text-ink-muted leading-tight">{usuario.email}</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
            {iniciais}
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors p-2 rounded-lg"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
