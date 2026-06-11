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
  Truck, UsersRound, IdCard, ClipboardCheck, Smartphone, ShieldCheck, UserCog, Upload, Landmark, Mail, Building2,
} from "lucide-react";

type Icone = React.ComponentType<{ className?: string }>;

interface Item {
  href: string;
  icone: Icone;
  label: string;
  /** Sobrescreve o alvo de ativação (ex.: itens com mesma rota). "__nunca__" = nunca ativo. */
  matchHref?: string;
}
interface Grupo {
  tipo: "grupo";
  label: string;
  icone: Icone;
  itens: Item[];
}
interface Secao {
  titulo: string;
  entries: (Item | Grupo)[];
}

const ehGrupo = (e: Item | Grupo): e is Grupo => (e as Grupo).tipo === "grupo";

// ─────────────────────────────────────────────
// Estrutura de navegação (apenas reorganização — todas as rotas preservadas)
// ─────────────────────────────────────────────
const SECOES: Secao[] = [
  {
    titulo: "Núcleo operacional",
    entries: [
      { href: "/dashboard", icone: LayoutDashboard, label: "Dashboard" },
      { href: "/clientes", icone: Users, label: "Clientes" },
    ],
  },
  {
    titulo: "Campo e execução",
    entries: [
      {
        tipo: "grupo", label: "Operações", icone: ClipboardList, itens: [
          { href: "/ordens", icone: ClipboardList, label: "Ordens de Serviço" },
          { href: "/calendario", icone: CalendarDays, label: "Calendário" },
          { href: "/prazos", icone: Timer, label: "Prazos e SLA" },
        ],
      },
      {
        tipo: "grupo", label: "Equipamentos", icone: Thermometer, itens: [
          { href: "/equipamentos", icone: Thermometer, label: "Todos os equipamentos" },
          { href: "/qrcodes", icone: QrCode, label: "QR Codes" },
        ],
      },
    ],
  },
  {
    titulo: "Comercial",
    entries: [
      {
        tipo: "grupo", label: "Propostas e contratos", icone: FileText, itens: [
          { href: "/orcamentos", icone: Calculator, label: "Orçamentos" },
          { href: "/contratos", icone: FileText, label: "Contratos" },
        ],
      },
      {
        tipo: "grupo", label: "Financeiro", icone: Wallet, itens: [
          { href: "/financeiro", icone: LayoutDashboard, label: "Dashboard financeiro" },
          { href: "/financeiro/contas-receber", icone: Receipt, label: "Contas a receber" },
          { href: "/financeiro/contas-pagar", icone: Upload, label: "Contas a pagar" },
          { href: "/financeiro/medicoes", icone: FileBarChart, label: "Medições" },
          { href: "/financeiro/fluxo-caixa", icone: TrendingUp, label: "Fluxo de caixa" },
          { href: "/compras/pedidos", icone: ShoppingCart, label: "Pedidos de compra" },
          { href: "/financeiro/contas-bancarias", icone: Landmark, label: "Contas bancárias" },
        ],
      },
    ],
  },
  {
    titulo: "Pessoas e frota",
    entries: [
      {
        tipo: "grupo", label: "Equipes", icone: UsersRound, itens: [
          { href: "/colaboradores", icone: HardHat, label: "Colaboradores" },
          { href: "/equipes", icone: UsersRound, label: "Equipes" },
        ],
      },
      {
        tipo: "grupo", label: "Frota", icone: Truck, itens: [
          { href: "/veiculos", icone: Truck, label: "Veículos" },
          { href: "/configuracoes/checklists-veiculo", icone: ClipboardCheck, label: "Checklists de veículo" },
        ],
      },
    ],
  },
  {
    titulo: "Sistema",
    entries: [
      {
        tipo: "grupo", label: "Configurações operacionais", icone: Cog, itens: [
          { href: "/configuracoes/tipos-os", icone: ListChecks, label: "Tipos de OS" },
          { href: "/configuracoes/tipos-equipamento", icone: Thermometer, label: "Tipos de equipamento" },
          { href: "/configuracoes/formularios", icone: FileSpreadsheet, label: "Formulários" },
          { href: "/configuracoes/formularios-por-tipo", icone: FileSpreadsheet, label: "Formulários por tipo" },
          { href: "/configuracoes/servicos", icone: Wrench, label: "Serviços" },
          { href: "/configuracoes/produtos", icone: Package, label: "Produtos" },
          { href: "/configuracoes/tabelas-preco", icone: Tags, label: "Tabelas de preços" },
          { href: "/configuracoes/termos", icone: ScrollText, label: "Termos de referência" },
          { href: "/configuracoes/prazos", icone: Clock, label: "Modelos de prazo" },
          { href: "/configuracoes/financeiro/categorias", icone: Tags, label: "Categorias financeiras" },
        ],
      },
      {
        tipo: "grupo", label: "Configurações da conta", icone: Settings, itens: [
          { href: "/configuracoes", icone: Building2, label: "Dados da empresa" },
          { href: "/configuracoes/perfis", icone: ShieldCheck, label: "Perfis de acesso" },
          { href: "/configuracoes/usuarios", icone: UserCog, label: "Usuários" },
          { href: "/configuracoes/cargos", icone: IdCard, label: "Cargos" },
          { href: "/configuracoes#preferencias", icone: Cog, label: "Preferências", matchHref: "__nunca__" },
          { href: "/configuracoes/email", icone: Mail, label: "E-mail transacional" },
          { href: "/configuracoes/portal", icone: Headset, label: "Portal do cliente" },
          { href: "/configuracoes/qr-code", icone: QrCode, label: "Config. QR Code" },
        ],
      },
    ],
  },
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
  const usuario = session.user;

  // Permissão de visualização por rota (1º segmento → módulo)
  const permissoes = (usuario as any).permissoes;
  const role = usuario.role;
  const podeVer = (href: string) => {
    const m = moduloDaRota(href.split("#")[0]);
    return !m || pode(permissoes, m, "visualizar", role);
  };

  // Base do href (sem hash) p/ casamento de rota
  const baseHref = (href: string, matchHref?: string) => matchHref ?? href.split("#")[0];

  // Determina o item ativo pelo prefixo mais longo (ex.: /financeiro vs /financeiro/contas-receber)
  const todasBases = SECOES.flatMap((s) =>
    s.entries.flatMap((e) => (ehGrupo(e) ? e.itens : [e]).map((i) => baseHref(i.href, i.matchHref))),
  ).filter((b) => b !== "__nunca__");
  let ativoHref: string | null = null;
  for (const b of todasBases) {
    if (pathname === b || pathname.startsWith(b + "/")) {
      if (!ativoHref || b.length > ativoHref.length) ativoHref = b;
    }
  }
  const itemAtivo = (i: Item) => baseHref(i.href, i.matchHref) === ativoHref;

  // Estado de expansão dos grupos (abre o que contém o item ativo)
  const grupoAtivo = (g: Grupo) => g.itens.some((i) => itemAtivo(i));
  const [abertos, setAbertos] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const sec of SECOES) for (const e of sec.entries) if (ehGrupo(e) && grupoAtivo(e)) s.add(e.label);
    return s;
  });
  const toggle = (label: string) =>
    setAbertos((p) => { const n = new Set(p); if (n.has(label)) n.delete(label); else n.add(label); return n; });

  const iniciais =
    usuario.name
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "??";
  const cargoLabel = ROLE_LABELS[usuario.role] ?? usuario.role;

  // Filtra itens/grupos/seções por permissão
  const secoesVisiveis = SECOES.map((sec) => {
    const entries = sec.entries
      .map((e) => {
        if (!ehGrupo(e)) return podeVer(e.href) ? e : null;
        const itens = e.itens.filter((i) => podeVer(i.href));
        return itens.length > 0 ? { ...e, itens } : null;
      })
      .filter(Boolean) as (Item | Grupo)[];
    return { ...sec, entries };
  }).filter((sec) => sec.entries.length > 0);

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
        {secoesVisiveis.map((sec, idx) => (
          <div key={sec.titulo} className={cn(idx > 0 && "mt-5")}>
            <div className="space-y-1">
              {sec.entries.map((e) =>
                ehGrupo(e) ? (
                  <div key={e.label}>
                    <button
                      onClick={() => toggle(e.label)}
                      className={cn(
                        "relative flex items-center justify-between w-full pl-4 pr-3 py-2.5 rounded-lg text-sm transition-all",
                        grupoAtivo(e)
                          ? "bg-primary-500 text-white font-semibold"
                          : "text-slate-200 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      {grupoAtivo(e) && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />}
                      <span className="flex items-center gap-3">
                        <e.icone className="w-[18px] h-[18px]" />
                        {e.label}
                      </span>
                      {abertos.has(e.label) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>

                    {abertos.has(e.label) && (
                      <div className="ml-5 pl-3 border-l border-white/10 space-y-0.5 mt-1">
                        {e.itens.map((i) => (
                          <Link
                            key={i.href + i.label}
                            href={i.href}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors",
                              itemAtivo(i)
                                ? "bg-white/10 text-white font-medium"
                                : "text-slate-300 hover:bg-white/5 hover:text-white",
                            )}
                          >
                            <i.icone className="w-3.5 h-3.5 shrink-0" />
                            {i.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <SidebarLink key={e.href} href={e.href} icone={e.icone} label={e.label} ativo={itemAtivo(e)} />
                ),
              )}
            </div>
          </div>
        ))}
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
  icone: Icone;
  label: string;
  ativo: boolean;
}

function SidebarLink({ href, icone: Icone, label, ativo }: SidebarLinkProps) {
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
      {ativo && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />}
      <Icone className="w-[18px] h-[18px] shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
