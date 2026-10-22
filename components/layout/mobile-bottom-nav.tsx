"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { LayoutDashboard, ClipboardList, CalendarDays, Users, Menu } from "lucide-react";

const ITENS = [
  { href: "/dashboard", icone: LayoutDashboard, label: "Início", modulo: "dashboard" },
  { href: "/ordens", icone: ClipboardList, label: "OS", modulo: "ordens" },
  { href: "/calendario", icone: CalendarDays, label: "Agenda", modulo: "calendario" },
  { href: "/clientes", icone: Users, label: "Clientes", modulo: "clientes" },
];

/**
 * Menu inferior fixo do mobile (lg:hidden). O botão "Mais" abre o drawer lateral
 * via o evento global ouvido pelo MobileShell. Itens seguem o RBAC, como a gaveta (I3).
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const { pode } = usePermissoes();
  const itens = ITENS.filter((i) => pode(i.modulo));

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-surface-border shadow-[0_-2px_8px_rgba(0,0,0,0.04)] safe-bottom">
      <div className={cn("grid", itens.length === 4 ? "grid-cols-5" : itens.length === 3 ? "grid-cols-4" : itens.length === 2 ? "grid-cols-3" : "grid-cols-2")}>
        {itens.map(({ href, icone: Icone, label }) => {
          const ativo = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 touch-target transition-colors",
                ativo ? "text-primary-600" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icone className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("frivo:toggle-menu"))}
          className="flex flex-col items-center justify-center gap-0.5 py-2 touch-target text-ink-muted hover:text-ink transition-colors"
        >
          <Menu className="w-5 h-5" />
          <span className="text-[10px] font-medium">Mais</span>
        </button>
      </div>
    </nav>
  );
}
