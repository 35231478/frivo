"use client";

import { signOut } from "next-auth/react";
import { Bell, ChevronRight, LogOut, Search, AlertTriangle, Clock, ShoppingCart, Timer, Headset, ClipboardCheck, FileWarning, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "next-auth";

interface Alertas {
  prazosVencidos: number;
  etapasVencendoHoje: number;
  pedidosPendentes: number;
  atendimentosAtraso: number;
  chamadosPortal: number;
  checklistPendente: number;
  checklistsComAlertas: number;
  documentosVencendo: number;
  veiculosManutencao: number;
  total: number;
}

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
  colaboradores: "Colaboradores",
  equipes: "Equipes",
  veiculos: "Veículos",
  checklist: "Checklist",
  cargos: "Cargos",
  "checklists-veiculo": "Checklists de Veículo",
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

  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [sinoAberto, setSinoAberto] = useState(false);
  const sinoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/alertas").then((r) => r.json()).then(setAlertas).catch(() => {});
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (sinoRef.current && !sinoRef.current.contains(e.target as Node)) setSinoAberto(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const total = alertas?.total ?? 0;
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
        <div className="relative" ref={sinoRef}>
          <button
            onClick={() => setSinoAberto((v) => !v)}
            className="relative p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt transition-colors"
            title="Alertas de prazos"
          >
            <Bell className="w-5 h-5" />
            {total > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-white flex items-center justify-center">
                {total > 99 ? "99+" : total}
              </span>
            )}
          </button>

          {sinoAberto && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-surface-border rounded-xl shadow-card-hover z-30 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-border">
                <p className="text-sm font-bold text-ink">Alertas de prazos</p>
              </div>
              {total === 0 ? (
                <p className="text-sm text-ink-muted text-center py-6">Nenhum alerta no momento 🎉</p>
              ) : (
                <div className="divide-y divide-surface-border">
                  <AlertaItem href="/prazos?status=ATRASADO" icone={AlertTriangle} cor="text-red-600" label="Prazos vencidos" valor={alertas?.prazosVencidos ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/prazos?status=ATIVO" icone={Clock} cor="text-amber-600" label="Vencendo hoje" valor={alertas?.etapasVencendoHoje ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/compras/pedidos" icone={ShoppingCart} cor="text-orange-600" label="Compras pendentes" valor={alertas?.pedidosPendentes ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/ordens?origem=PORTAL_CLIENTE" icone={Headset} cor="text-cyan-600" label="Chamados do portal" valor={alertas?.chamadosPortal ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/ordens" icone={Timer} cor="text-red-600" label="Atendimentos em atraso" valor={alertas?.atendimentosAtraso ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/veiculos/checklist" icone={ClipboardCheck} cor="text-blue-600" label="Checklists pendentes" valor={alertas?.checklistPendente ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/veiculos" icone={AlertTriangle} cor="text-amber-600" label="Checklists com alertas" valor={alertas?.checklistsComAlertas ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/veiculos" icone={FileWarning} cor="text-orange-600" label="Documentos de veículo vencendo" valor={alertas?.documentosVencendo ?? 0} onClick={() => setSinoAberto(false)} />
                  <AlertaItem href="/veiculos" icone={Wrench} cor="text-violet-600" label="Veículos em manutenção" valor={alertas?.veiculosManutencao ?? 0} onClick={() => setSinoAberto(false)} />
                </div>
              )}
            </div>
          )}
        </div>

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

function AlertaItem({
  href, icone: Icone, cor, label, valor, onClick,
}: {
  href: string;
  icone: React.ComponentType<{ className?: string }>;
  cor: string;
  label: string;
  valor: number;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-alt transition-colors">
      <span className="flex items-center gap-2.5 text-sm text-ink">
        <Icone className={`w-4 h-4 ${cor}`} />
        {label}
      </span>
      <span className={valor > 0 ? "text-sm font-bold text-ink" : "text-sm text-ink-subtle"}>{valor}</span>
    </Link>
  );
}
