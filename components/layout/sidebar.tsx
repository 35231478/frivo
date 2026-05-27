"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Users, Thermometer, ClipboardList, FileText,
  HardHat, Snowflake, Settings, ChevronDown, ChevronRight,
  Wrench, FileSpreadsheet, Cog, Package, ListChecks,
} from "lucide-react";

const itensMenu = [
  { href: "/dashboard", icone: LayoutDashboard, label: "Dashboard" },
  { href: "/clientes", icone: Users, label: "Clientes" },
  { href: "/equipamentos", icone: Thermometer, label: "Equipamentos" },
  { href: "/ordens", icone: ClipboardList, label: "Ordens de Serviço" },
  { href: "/contratos", icone: FileText, label: "Contratos" },
  { href: "/tecnicos", icone: HardHat, label: "Técnicos" },
];

const itensCadastros = [
  { href: "/configuracoes/tipos-os", icone: ListChecks, label: "Tipos de OS" },
  { href: "/configuracoes/formularios", icone: FileSpreadsheet, label: "Formulários" },
  { href: "/configuracoes/tipos-equipamento", icone: Thermometer, label: "Tipos de Equipamento" },
  { href: "/configuracoes/servicos", icone: Wrench, label: "Serviços" },
  { href: "/configuracoes/produtos", icone: Package, label: "Produtos" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [cadastrosAberto, setCadastrosAberto] = useState(
    itensCadastros.some(({ href }) => pathname.startsWith(href))
  );

  const configAtivo = pathname === "/configuracoes" || pathname.startsWith("/configuracoes/");
  const cadastroAtivo = itensCadastros.some(({ href }) => pathname.startsWith(href));

  return (
    <aside className="hidden lg:flex flex-col w-60 bg-frivo-950 text-white shrink-0">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="bg-frivo-600 rounded-lg p-1.5">
          <Snowflake className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight">Frivo</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {itensMenu.map(({ href, icone: Icone, label }) => {
          const ativo = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                ativo ? "bg-frivo-700 text-white font-medium" : "text-frivo-200 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icone className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-white/10 space-y-0.5">
        {/* Configurações Gerais */}
        <Link
          href="/configuracoes"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
            configAtivo && !cadastroAtivo ? "bg-frivo-700 text-white font-medium" : "text-frivo-200 hover:bg-white/10 hover:text-white",
          )}
        >
          <Settings className="w-4 h-4" />
          Configurações
        </Link>

        {/* Cadastros — submenu expansível */}
        <button
          onClick={() => setCadastrosAberto(!cadastrosAberto)}
          className={cn(
            "flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm transition-colors",
            cadastroAtivo ? "bg-frivo-700 text-white font-medium" : "text-frivo-200 hover:bg-white/10 hover:text-white",
          )}
        >
          <span className="flex items-center gap-3">
            <Cog className="w-4 h-4" />
            Cadastros
          </span>
          {cadastrosAberto ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {cadastrosAberto && (
          <div className="ml-4 pl-3 border-l border-white/10 space-y-0.5">
            {itensCadastros.map(({ href, icone: Icone, label }) => {
              const ativo = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-colors",
                    ativo ? "bg-frivo-700/80 text-white font-medium" : "text-frivo-300 hover:bg-white/10 hover:text-white",
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
    </aside>
  );
}
