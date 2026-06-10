"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, ClipboardList, CalendarDays, Users, Menu } from "lucide-react";

const ITENS = [
  { href: "/dashboard", icone: LayoutDashboard, label: "Início" },
  { href: "/ordens", icone: ClipboardList, label: "OS" },
  { href: "/calendario", icone: CalendarDays, label: "Agenda" },
  { href: "/clientes", icone: Users, label: "Clientes" },
];

/**
 * Menu inferior fixo do mobile (lg:hidden). O botão "Mais" abre o drawer lateral
 * via o evento global ouvido pelo MobileShell.
 */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-surface-border shadow-[0_-2px_8px_rgba(0,0,0,0.04)] safe-bottom">
      <div className="grid grid-cols-5">
        {ITENS.map(({ href, icone: Icone, label }) => {
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
