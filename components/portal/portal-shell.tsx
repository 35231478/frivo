"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { portalLogout } from "@/app/(portal)/portal/actions";
import { LayoutDashboard, Headset, Thermometer, FileText, Wallet, CalendarDays, LogOut } from "lucide-react";

interface Branding { empresaNome: string; logo: string | null; cor: string }
interface Props {
  contatoNome: string;
  clienteNome: string;
  branding: Branding;
  permissoes: Record<string, boolean>;
  children: React.ReactNode;
}

const ITENS = [
  { href: "/portal/dashboard", label: "Início", icone: LayoutDashboard, perm: null },
  { href: "/portal/chamados", label: "Chamados", icone: Headset, perm: null },
  { href: "/portal/equipamentos", label: "Equipamentos", icone: Thermometer, perm: "verEquipamentos" },
  { href: "/portal/documentos", label: "Documentos", icone: FileText, perm: "verDocumentos" },
  { href: "/portal/financeiro", label: "Financeiro", icone: Wallet, perm: "verFinanceiro" },
  { href: "/portal/agenda", label: "Agenda", icone: CalendarDays, perm: null },
];

export function PortalShell({ contatoNome, clienteNome, branding, permissoes, children }: Props) {
  const pathname = usePathname();
  const itens = ITENS.filter((i) => !i.perm || permissoes?.[i.perm]);
  const cor = branding.cor || "#0EA5E9";

  return (
    <div className="min-h-screen flex flex-col" style={{ ["--portal-cor" as any]: cor }}>
      {/* Header */}
      <header className="text-white shadow-sm" style={{ backgroundColor: "#0F2744" }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {branding.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logo} alt={branding.empresaNome} className="h-9 w-auto max-w-[140px] object-contain rounded bg-white/10 p-1" />
            ) : (
              <span className="font-bold text-lg">{branding.empresaNome}</span>
            )}
            <div className="hidden sm:block min-w-0">
              <p className="text-xs text-white/60 leading-none">Portal do Cliente</p>
              <p className="text-sm font-semibold truncate">{clienteNome}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm hidden md:inline">Olá, {contatoNome.split(" ")[0]}</span>
            <form action={portalLogout}>
              <button type="submit" className="inline-flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors">
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </form>
          </div>
        </div>

        {/* Nav desktop */}
        <nav className="hidden md:block border-t border-white/10">
          <div className="max-w-5xl mx-auto px-4 flex gap-1">
            {itens.map((i) => {
              const ativo = pathname === i.href || pathname.startsWith(i.href + "/");
              return (
                <Link key={i.href} href={i.href}
                  className={cn("flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 transition-colors", ativo ? "border-white text-white font-semibold" : "border-transparent text-white/70 hover:text-white")}>
                  <i.icone className="w-4 h-4" /> {i.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 pb-24 md:pb-6">{children}</main>

      {/* Nav inferior mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-surface-border flex justify-around z-30">
        {itens.map((i) => {
          const ativo = pathname === i.href || pathname.startsWith(i.href + "/");
          return (
            <Link key={i.href} href={i.href}
              className={cn("flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px]", ativo ? "font-semibold" : "text-ink-muted")}
              style={ativo ? { color: cor } : undefined}>
              <i.icone className="w-5 h-5" /> {i.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
