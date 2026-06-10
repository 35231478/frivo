"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { moduloDaRota, pode } from "@/lib/permissoes";
import { FrivoLogo } from "./frivo-logo";
import type { Session } from "next-auth";
import {
  LayoutDashboard, Users, Thermometer, ClipboardList, FileText,
  HardHat, Settings, ChevronDown, ChevronRight,
  Wrench, FileSpreadsheet, Cog, Package, ListChecks, Calculator,
  Wallet, Receipt, TrendingUp, FileBarChart, Clock, ShoppingCart, Timer, Tags, CalendarDays, Headset, ScrollText, QrCode,
  Truck, UsersRound, IdCard, ClipboardCheck, Smartphone, ShieldCheck, UserCog,
} from "lucide-react";

const itensMenu = [
  { href: "/dashboard",    icone: LayoutDashboard, label: "Dashboard" },
  { href: "/clientes",     icone: Users,           label: "Clientes" },
  { href: "/equipamentos", icone: Thermometer,     label: "Equipamentos" },
  { href: "/qrcodes",      icone: QrCode,          label: "QR Codes" },
  { href: "/ordens",       icone: ClipboardList,   label: "Ordens de Serviço" },
  { href: "/calendario",   icone: CalendarDays,    label: "Calendário" },
  { href: "/orcamentos",   icone: Calculator,      label: "Orçamentos" },
  { href: "/contratos",    icone: FileText,        label: "Contratos" },
  { href: "/prazos",       icone: Timer,           label: "Prazos" },
];

const itensEquipes = [
  { href: "/colaboradores", icone: HardHat,     label: "Colaboradores" },
  { href: "/equipes",       icone: UsersRound,  label: "Equipes" },
  { href: "/veiculos",      icone: Truck,       label: "Veículos" },
];

const itensFinanceiro = [
  { href: "/financeiro/medicoes",        icone: FileBarChart, label: "Medições" },
  { href: "/financeiro/contas-receber",  icone: Receipt,      label: "Contas a Receber" },
  { href: "/financeiro/fluxo-caixa",     icone: TrendingUp,   label: "Fluxo de Caixa" },
];

const itensCompras = [
  { href: "/compras/pedidos", icone: ShoppingCart, label: "Pedidos de Compra" },
];

const itensCadastros = [
  { href: "/configuracoes/perfis",            icone: ShieldCheck,      label: "Perfis de Acesso" },
  { href: "/configuracoes/usuarios",          icone: UserCog,          label: "Usuários" },
  { href: "/configuracoes/cargos",            icone: IdCard,           label: "Cargos" },
  { href: "/configuracoes/checklists-veiculo", icone: ClipboardCheck,  label: "Checklists de Veículo" },
  { href: "/configuracoes/tipos-os",          icone: ListChecks,       label: "Tipos de OS" },
  { href: "/configuracoes/formularios",       icone: FileSpreadsheet,  label: "Formulários" },
  { href: "/configuracoes/tipos-equipamento", icone: Thermometer,      label: "Tipos de Equipamento" },
  { href: "/configuracoes/servicos",          icone: Wrench,           label: "Serviços" },
  { href: "/configuracoes/produtos",          icone: Package,          label: "Produtos" },
  { href: "/configuracoes/tabelas-preco",     icone: Tags,             label: "Tabelas de Preços" },
  { href: "/configuracoes/prazos",            icone: Clock,            label: "Prazos e SLA" },
  { href: "/configuracoes/termos",            icone: ScrollText,       label: "Termos de Referência" },
  { href: "/configuracoes/portal",            icone: Headset,          label: "Portal do Cliente" },
  { href: "/configuracoes/qr-code",           icone: QrCode,           label: "QR Code" },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  TECNICO: "Técnico",
  OPERADOR: "Operador",
};

interface SidebarProps {
  session: Session;
  variant?: "desktop" | "mobile";
}

export function Sidebar({ session, variant = "desktop" }: SidebarProps) {
  const pathname = usePathname();
  const [cadastrosAberto, setCadastrosAberto] = useState(
    itensCadastros.some(({ href }) => pathname.startsWith(href))
  );
  const [financeiroAberto, setFinanceiroAberto] = useState(
    pathname.startsWith("/financeiro")
  );
  const [comprasAberto, setComprasAberto] = useState(
    pathname.startsWith("/compras")
  );
  const [equipesAberto, setEquipesAberto] = useState(
    itensEquipes.some(({ href }) => pathname.startsWith(href))
  );

  const configAtivo = pathname === "/configuracoes" || pathname.startsWith("/configuracoes/");
  const cadastroAtivo = itensCadastros.some(({ href }) => pathname.startsWith(href));
  const financeiroAtivo = pathname.startsWith("/financeiro");
  const comprasAtivo = pathname.startsWith("/compras");
  const equipesAtivo = itensEquipes.some(({ href }) => pathname.startsWith(href));

  const usuario = session.user;
  const iniciais =
    usuario.name
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "??";
  const cargoLabel = ROLE_LABELS[usuario.role] ?? usuario.role;

  // Filtragem por permissão de visualização do módulo
  const permissoes = (usuario as any).permissoes;
  const role = usuario.role;
  const podeVer = (href: string) => {
    const m = moduloDaRota(href);
    return !m || pode(permissoes, m, "visualizar", role);
  };
  const menuVisivel = itensMenu.filter((i) => podeVer(i.href));
  const equipesVisiveis = itensEquipes.filter((i) => podeVer(i.href));
  const financeiroVisiveis = itensFinanceiro.filter((i) => podeVer(i.href));
  const podeConfig = pode(permissoes, "configuracoes", "visualizar", role);

  return (
    <aside className={cn(
      "flex flex-col bg-sidebar text-white shrink-0 shadow-xl",
      variant === "mobile" ? "w-72 h-full" : "hidden lg:flex w-64",
    )}>
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
          {menuVisivel.map(({ href, icone: Icone, label }) => (
            <SidebarLink key={href} href={href} icone={Icone} label={label} pathname={pathname} />
          ))}

          {/* Equipes — submenu expansível */}
          {equipesVisiveis.length > 0 && (<>
          <button
            onClick={() => setEquipesAberto((v) => !v)}
            className={cn(
              "relative flex items-center justify-between w-full pl-4 pr-3 py-2.5 rounded-lg text-sm transition-all",
              equipesAtivo
                ? "bg-primary-500 text-white font-semibold"
                : "text-slate-200 hover:bg-white/5 hover:text-white",
            )}
          >
            {equipesAtivo && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />
            )}
            <span className="flex items-center gap-3">
              <UsersRound className="w-[18px] h-[18px]" />
              Equipes
            </span>
            {equipesAberto ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          {equipesAberto && (
            <div className="ml-5 pl-3 border-l border-white/10 space-y-0.5 mt-1">
              {equipesVisiveis.map(({ href, icone: Icone, label }) => {
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
          </>)}

          {/* Financeiro — submenu expansível */}
          {financeiroVisiveis.length > 0 && (<>
          <button
            onClick={() => setFinanceiroAberto((v) => !v)}
            className={cn(
              "relative flex items-center justify-between w-full pl-4 pr-3 py-2.5 rounded-lg text-sm transition-all",
              financeiroAtivo
                ? "bg-primary-500 text-white font-semibold"
                : "text-slate-200 hover:bg-white/5 hover:text-white",
            )}
          >
            {financeiroAtivo && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />
            )}
            <span className="flex items-center gap-3">
              <Wallet className="w-[18px] h-[18px]" />
              Financeiro
            </span>
            {financeiroAberto ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          {financeiroAberto && (
            <div className="ml-5 pl-3 border-l border-white/10 space-y-0.5 mt-1">
              {financeiroVisiveis.map(({ href, icone: Icone, label }) => {
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
          </>)}

          {/* Compras — submenu expansível */}
          <button
            onClick={() => setComprasAberto((v) => !v)}
            className={cn(
              "relative flex items-center justify-between w-full pl-4 pr-3 py-2.5 rounded-lg text-sm transition-all",
              comprasAtivo
                ? "bg-primary-500 text-white font-semibold"
                : "text-slate-200 hover:bg-white/5 hover:text-white",
            )}
          >
            {comprasAtivo && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />
            )}
            <span className="flex items-center gap-3">
              <ShoppingCart className="w-[18px] h-[18px]" />
              Compras
            </span>
            {comprasAberto ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          {comprasAberto && (
            <div className="ml-5 pl-3 border-l border-white/10 space-y-0.5 mt-1">
              {itensCompras.map(({ href, icone: Icone, label }) => {
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

        <div className="my-4 border-t border-white/5" />

        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Sistema
        </p>
        <div className="space-y-1">
          {podeConfig && (<>
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
          </>)}
        </div>
      </nav>

      {/* Instalar app */}
      <div className="px-3 pt-2">
        <Link
          href="/instalar"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          Instalar app no celular
        </Link>
      </div>

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
