"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { FrivoLogo } from "./frivo-logo";
import type { Session } from "next-auth";
import {
  LayoutDashboard, Users, Thermometer, ClipboardList, FileText,
  HardHat, Settings, ChevronDown, ChevronRight,
  Wrench, FileSpreadsheet, Cog, Package, ListChecks, Calculator,
} from "lucide-react";

const itensMenu = [
  { href: "/dashboard",    icone: LayoutDashboard, label: "Dashboard" },
  { href: "/clientes",     icone: Users,           label: "Clientes" },
  { href: "/equipamentos", icone: Thermometer,     label: "Equipamentos" },
  { href: "/ordens",       icone: ClipboardList,   label: "Ordens de Serviço" },
  { href: "/orcamentos",   icone: Calculator,      label: "Orçamentos" },
  { href: "/contratos",    icone: FileText,        label: "Contratos" },
  { href: "/tecnicos",     icone: HardHat,         label: "Técnicos" },
];

const itensCadastros = [
  { href: "/configuracoes/tipos-os",          icone: ListChecks,       label: "Tipos de OS" },
  { href: "/configuracoes/formularios",       icone: FileSpreadsheet,  label: "Formulários" },
  { href: "/configuracoes/tipos-equipamento", icone: Thermometer,      label: "Tipos de Equipamento" },
  { href: "/configuracoes/servicos",          icone: Wrench,           label: "Serviços" },
  { href: "/configuracoes/produtos",          icone: Package,          label: "Produtos" },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  TECNICO: "Técnico",
  OPERADOR: "Operador",
};

interface SidebarProps {
  session: Session;
}

export function Sidebar({ session }: SidebarProps) {
  const pathname = usePathname();
  const [cadastrosAberto, setCadastrosAberto] = useState(
    itensCadastros.some(({ href }) => pathname.startsWith(href))
  );

  const configAtivo = pathname === "/configuracoes" || pathname.startsWith("/configuracoes/");
  const cadastroAtivo = itensCadastros.some(({ href }) => pathname.startsWith(href));

  const usuario = session.user;
  const iniciais =
    usuario.name
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "??";
  const cargoLabel = ROLE_LABELS[usuario.role] ?? usuario.role;

  return (
    <aside className="hidden lg:flex flex-col w-64 bg-sidebar text-white shrink-0 shadow-xl">
      {/* Logo */}
      <div className="flex items-center px-5 py-5 border-b border-white/5">
        <FrivoLogo size="md" />
      </div>

      {/* Navegação principal */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Operação
        </p>
        <div className="space-y-1">
          {itensMenu.map(({ href, icone: Icone, label }) => (
            <SidebarLink key={href} href={href} icone={Icone} label={label} pathname={pathname} />
          ))}
        </div>

        <div className="my-4 border-t border-white/5" />

        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Sistema
        </p>
        <div className="space-y-1">
          <SidebarLink
            href="/configuracoes"
            icone={Settings}
            label="Configurações"
            pathname={pathname}
            forceActive={configAtivo && !cadastroAtivo}
          />

          {/* Cadastros — submenu expansível */}
          <button
            onClick={() => setCadastrosAberto((v) => !v)}
            className={cn(
              "relative flex items-center justify-between w-full pl-4 pr-3 py-2.5 rounded-lg text-sm transition-all",
              cadastroAtivo
                ? "bg-primary-500 text-white font-semibold"
                : "text-slate-200 hover:bg-white/5 hover:text-white",
            )}
          >
            {cadastroAtivo && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />
            )}
            <span className="flex items-center gap-3">
              <Cog className="w-[18px] h-[18px]" />
              Cadastros
            </span>
            {cadastrosAberto ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          {cadastrosAberto && (
            <div className="ml-5 pl-3 border-l border-white/10 space-y-0.5 mt-1">
              {itensCadastros.map(({ href, icone: Icone, label }) => {
                const ativo = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors",
                      ativo
                        ? "bg-white/10 text-white font-medium"
                        : "text-slate-300 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icone className="w-3.5 h-3.5 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Usuário */}
      <div className="px-3 py-3 border-t border-white/5">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {iniciais}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{usuario.name ?? "Usuário"}</p>
            <p className="text-[11px] text-slate-400 truncate">{cargoLabel}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

interface SidebarLinkProps {
  href: string;
  icone: React.ComponentType<{ className?: string }>;
  label: string;
  pathname: string;
  forceActive?: boolean;
}

function SidebarLink({ href, icone: Icone, label, pathname, forceActive }: SidebarLinkProps) {
  const ativo = forceActive ?? (pathname === href || pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-lg text-sm transition-all",
        ativo
          ? "bg-primary-500 text-white font-semibold shadow-sm"
          : "text-slate-200 hover:bg-white/5 hover:text-white",
      )}
    >
      {ativo && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />
      )}
      <Icone className="w-[18px] h-[18px] shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
