"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { portalLogout } from "@/app/(portal)/portal/actions";
import { LayoutDashboard, Headset, Thermometer, FileText, Wallet, CalendarDays, LogOut } from "lucide-react";
import { acento } from "@/lib/ui/tokens";

interface Branding { empresaNome: string; logo: string | null; cor: string }
interface Props {
  contatoNome: string;
  clienteNome: string;
  branding: Branding;
  permissoes: Record<string, boolean>;
  children: React.ReactNode;
}

type Perms = Record<string, boolean>;
const ITENS: { href: string; label: string; icone: typeof LayoutDashboard; perm: (p: Perms) => boolean }[] = [
  { href: "/portal/dashboard", label: "Início", icone: LayoutDashboard, perm: () => true },
  { href: "/portal/chamados", label: "Chamados", icone: Headset, perm: (p) => !!(p?.verOS || p?.abrirChamados) },
  { href: "/portal/equipamentos", label: "Equipamentos", icone: Thermometer, perm: (p) => !!p?.verEquipamentos },
  { href: "/portal/documentos", label: "Documentos", icone: FileText, perm: (p) => !!p?.verDocumentos },
  // "Faturas" (rótulo leigo — C1): é aqui que o boleto e a fatura do mês se entregam sozinhos
  { href: "/portal/financeiro", label: "Faturas", icone: Wallet, perm: (p) => !!p?.verFinanceiro },
  { href: "/portal/agenda", label: "Agenda", icone: CalendarDays, perm: (p) => !!p?.verOS },
];

export function PortalShell({ contatoNome, clienteNome, branding, permissoes, children }: Props) {
  const pathname = usePathname();
  const itens = ITENS.filter((i) => i.perm(permissoes ?? {}));
  // A cor da empresa (configurada no portal) marca o topo; texto e item ativo ficam no acento, que tem contraste garantido
  const cor = branding.cor || acento.DEFAULT;

  return (
    <div className="min-h-screen flex flex-col" style={{ ["--portal-cor" as any]: cor }}>
      {/* Header */}
      <header className="bg-white border-b border-surface-border border-t-4" style={{ borderTopColor: cor }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {branding.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logo} alt={branding.empresaNome} className="h-9 w-auto max-w-[140px] object-contain rounded" />
            ) : (
              <span className="font-display font-bold text-lg text-ink">{branding.empresaNome}</span>
            )}
            <div className="hidden sm:block min-w-0">
              <p className="text-xs text-ink-muted leading-none">Portal do Cliente</p>
              <p className="text-sm font-semibold text-ink truncate">{clienteNome}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-muted hidden md:inline">Olá, {contatoNome.split(" ")[0]}</span>
            <form action={portalLogout}>
              <button type="submit" className="inline-flex items-center gap-1.5 text-sm text-ink bg-white border border-surface-border hover:bg-surface-page px-3 py-1.5 rounded-lg transition-colors">
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </form>
          </div>
        </div>

        {/* Nav desktop */}
        <nav className="hidden md:block border-t border-surface-linha">
          <div className="max-w-5xl mx-auto px-4 flex gap-1">
            {itens.map((i) => {
              const ativo = pathname === i.href || pathname.startsWith(i.href + "/");
              return (
                <Link key={i.href} href={i.href}
                  className={cn("flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 transition-colors", ativo ? "border-acento text-acento font-semibold" : "border-transparent text-ink-muted hover:text-ink")}>
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
              className={cn("flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px]", ativo ? "font-semibold text-acento" : "text-ink-muted")}>
              <i.icone className="w-5 h-5" /> {i.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
