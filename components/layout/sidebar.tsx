"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { moduloDaRota, pode } from "@/lib/permissoes";
import { FrivoLogo, FrivoMark } from "./frivo-logo";
import type { Session } from "next-auth";
import {
  LayoutDashboard, Users, Thermometer, ClipboardList, FileText,
  HardHat, Settings, ChevronDown, ChevronRight,
  Wrench, FileSpreadsheet, Cog, Package, ListChecks, Calculator,
  Wallet, Receipt, TrendingUp, FileBarChart, Clock, ShoppingCart, Timer, Tags, CalendarDays, Headset, ScrollText, QrCode,
  Truck, UsersRound, IdCard, ClipboardCheck, Smartphone, ShieldCheck, UserCog, Upload, Landmark, Mail, Building2,
  PanelLeftClose, PanelLeftOpen, MoreVertical, LogOut,
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

const STORAGE_KEY = "frivo:sidebar-recolhido";

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

interface SidebarProps {
  session: Session;
  variant?: "desktop" | "mobile";
  avatarUrl?: string | null;
}

export function Sidebar({ session, variant = "desktop", avatarUrl }: SidebarProps) {
  const pathname = usePathname();
  const usuario = session.user;

  // Recolher/expandir (apenas desktop) — persistido em localStorage
  const [recolhido, setRecolhido] = useState(false);
  const [montado, setMontado] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1") setRecolhido(true);
    setMontado(true);
  }, []);

  const toggleRecolher = () =>
    setRecolhido((v) => {
      const novo = !v;
      try { localStorage.setItem(STORAGE_KEY, novo ? "1" : "0"); } catch {}
      return novo;
    });

  const colapsada = variant === "desktop" && recolhido;

  // Permissão de visualização por rota (1º segmento → módulo)
  const permissoes = (usuario as any).permissoes;
  const role = usuario.role;
  const podeVer = (href: string) => {
    const m = moduloDaRota(href.split("#")[0]);
    return !m || pode(permissoes, m, "visualizar", role);
  };

  const baseHref = (href: string, matchHref?: string) => matchHref ?? href.split("#")[0];

  // Item ativo pelo prefixo mais longo (ex.: /financeiro vs /financeiro/contas-receber)
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
  const grupoAtivo = (g: Grupo) => g.itens.some((i) => itemAtivo(i));

  // Estado de expansão dos grupos (abre o que contém o item ativo)
  const [abertos, setAbertos] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const sec of SECOES) for (const e of sec.entries) if (ehGrupo(e) && e.itens.some((i) => baseHref(i.href, i.matchHref) === ativoHref)) s.add(e.label);
    return s;
  });
  const toggle = (label: string) =>
    setAbertos((p) => { const n = new Set(p); if (n.has(label)) n.delete(label); else n.add(label); return n; });

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
      montado && "transition-[width] duration-200 ease-in-out",
      variant === "mobile" ? "w-72 h-full" : cn("hidden lg:flex", colapsada ? "lg:w-16" : "lg:w-[280px]"),
    )}>
      {/* Toggle recolher/expandir (desktop) */}
      {variant === "desktop" && (
        <div className={cn("flex items-center px-3 pt-3", colapsada ? "justify-center" : "justify-end")}>
          <button
            onClick={toggleRecolher}
            title={colapsada ? "Expandir menu" : "Recolher menu"}
            className="p-1.5 rounded-lg text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            {colapsada ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        </div>
      )}

      {/* Perfil do usuário */}
      <div className="px-3 pt-2 pb-3 border-b border-white/5 relative">
        <button
          onClick={() => setMenuAberto((v) => !v)}
          className={cn("flex items-center w-full rounded-lg p-2 hover:bg-white/5 transition-colors", colapsada ? "justify-center" : "gap-3")}
        >
          <Avatar image={avatarUrl ?? usuario.image} name={usuario.name} />
          {!colapsada && (<>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-sm font-medium text-white truncate">{usuario.name ?? "Usuário"}</span>
              <span className="block text-[11px] text-slate-400 truncate">{usuario.email ?? ""}</span>
            </span>
            <MoreVertical className="w-4 h-4 text-slate-400 shrink-0" />
          </>)}
        </button>

        {menuAberto && (<>
          <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)} />
          <div className={cn(
            "absolute z-20 mt-1 w-52 bg-white rounded-lg shadow-xl border border-gray-100 py-1",
            colapsada ? "left-full ml-2 top-2" : "left-3 right-3",
          )}>
            <Link
              href="/perfil"
              onClick={() => setMenuAberto(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <UserCog className="w-4 h-4" /> Gerenciar perfil
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </>)}
      </div>

      {/* Navegação principal */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
        {secoesVisiveis.map((sec, idx) => (
          <div key={sec.titulo} className={cn(idx > 0 && "mt-5")}>
            <div className="space-y-1">
              {sec.entries.map((e) =>
                ehGrupo(e) ? (
                  colapsada ? (
                    <Link
                      key={e.label}
                      href={e.itens[0].href}
                      title={e.label}
                      className={cn(
                        "relative flex items-center justify-center py-2.5 rounded-lg transition-all",
                        grupoAtivo(e) ? "bg-primary-500 text-white" : "text-slate-200 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <e.icone className="w-[18px] h-[18px]" />
                    </Link>
                  ) : (
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
                  )
                ) : (
                  <SidebarLink key={e.href} href={e.href} icone={e.icone} label={e.label} ativo={itemAtivo(e)} colapsada={colapsada} />
                ),
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Rodapé: instalar app + logo */}
      <div className="px-3 pt-2 pb-3 border-t border-white/5 space-y-2">
        <Link
          href="/instalar"
          title={colapsada ? "Instalar app" : undefined}
          className={cn(
            "flex items-center rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors",
            colapsada ? "justify-center py-2" : "gap-2.5 px-3 py-2",
          )}
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          {!colapsada && "Instalar app no celular"}
        </Link>
        <div className={cn("flex pt-1", colapsada ? "justify-center" : "px-3")}>
          {colapsada ? <FrivoMark size={28} /> : <FrivoLogo size="sm" />}
        </div>
      </div>
    </aside>
  );
}

function Avatar({ image, name }: { image?: string | null; name?: string | null }) {
  const iniciais =
    name?.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() ?? "??";
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={name ?? "Usuário"} className="w-9 h-9 rounded-full object-cover shrink-0" />;
  }
  return (
    <span className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
      {iniciais}
    </span>
  );
}

interface SidebarLinkProps {
  href: string;
  icone: Icone;
  label: string;
  ativo: boolean;
  colapsada: boolean;
}

function SidebarLink({ href, icone: Icone, label, ativo, colapsada }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      title={colapsada ? label : undefined}
      className={cn(
        "relative flex items-center rounded-lg text-sm transition-all",
        colapsada ? "justify-center py-2.5" : "gap-3 pl-4 pr-3 py-2.5",
        ativo
          ? "bg-primary-500 text-white font-semibold shadow-sm"
          : "text-slate-200 hover:bg-white/5 hover:text-white",
      )}
    >
      {ativo && !colapsada && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />}
      <Icone className="w-[18px] h-[18px] shrink-0" />
      {!colapsada && <span className="truncate">{label}</span>}
    </Link>
  );
}
