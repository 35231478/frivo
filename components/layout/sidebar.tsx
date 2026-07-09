"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Truck, UsersRound, IdCard, ClipboardCheck, Smartphone, ShieldCheck, UserCog, Upload, Landmark, Mail, Building2, Globe, Coins,
  PanelLeftClose, PanelLeftOpen, MoreVertical, LogOut,
} from "lucide-react";

type Icone = React.ComponentType<{ className?: string }>;

interface Item {
  href: string;
  icone: Icone;
  label: string;
  /** Sobrescreve o alvo de ativação (ex.: itens com mesma rota). "__nunca__" = nunca ativo. */
  matchHref?: string;
  /** Sobrescreve o módulo de permissão (quando o 1º segmento da rota não reflete o gate correto). */
  modulo?: string;
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
const MODULO_KEY = "frivo:sidebar-modulo";

// ─────────────────────────────────────────────
// Estrutura de navegação por MÓDULO ("mundos")
// Apenas reorganização — todas as rotas são preservadas (nenhuma rota nova/alterada).
// O título das seções serve apenas para agrupar/espaçar (não é exibido).
// ─────────────────────────────────────────────

/** Módulo OPERACIONAL — dia a dia de campo, comercial, equipes e frota. */
const OPERACIONAL: Secao[] = [
  {
    titulo: "Início",
    entries: [
      { href: "/dashboard", icone: LayoutDashboard, label: "Dashboard" },
      { href: "/clientes", icone: Users, label: "Clientes" },
    ],
  },
  {
    titulo: "op-grupos",
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
      {
        tipo: "grupo", label: "Comercial", icone: FileText, itens: [
          { href: "/orcamentos", icone: Calculator, label: "Orçamentos" },
          { href: "/contratos", icone: FileText, label: "Contratos" },
          { href: "/leads-site", icone: Globe, label: "Leads do Site" },
        ],
      },
      {
        tipo: "grupo", label: "Equipes", icone: UsersRound, itens: [
          { href: "/colaboradores", icone: HardHat, label: "Colaboradores" },
          { href: "/equipes", icone: UsersRound, label: "Equipes" },
        ],
      },
      {
        tipo: "grupo", label: "Frota", icone: Truck, itens: [
          { href: "/veiculos", icone: Truck, label: "Veículos" },
          { href: "/configuracoes/checklists-veiculo", icone: ClipboardCheck, label: "Checklists", modulo: "veiculos" },
        ],
      },
    ],
  },
];

/** Módulo FINANCEIRO — recebimentos, pagamentos e tesouraria. */
const FINANCEIRO: Secao[] = [
  {
    titulo: "Visão geral",
    entries: [
      { href: "/financeiro", icone: Wallet, label: "Dashboard financeiro", modulo: "financeiro" },
      { href: "/financeiro/fluxo-caixa", icone: TrendingUp, label: "Fluxo de caixa", modulo: "financeiro" },
    ],
  },
  {
    titulo: "fin-grupos",
    entries: [
      {
        tipo: "grupo", label: "Recebimentos", icone: Receipt, itens: [
          { href: "/financeiro/contas-receber", icone: Receipt, label: "Contas a receber", modulo: "financeiro" },
          { href: "/financeiro/medicoes", icone: FileBarChart, label: "Medições", modulo: "financeiro" },
        ],
      },
      {
        tipo: "grupo", label: "Pagamentos", icone: Upload, itens: [
          { href: "/financeiro/contas-pagar", icone: Upload, label: "Contas a pagar", modulo: "financeiro" },
          { href: "/compras/pedidos", icone: ShoppingCart, label: "Pedidos de compra", modulo: "financeiro" },
        ],
      },
      {
        tipo: "grupo", label: "Tesouraria", icone: Landmark, itens: [
          { href: "/financeiro/contas-bancarias", icone: Landmark, label: "Contas bancárias", modulo: "financeiro" },
        ],
      },
    ],
  },
];

/** Bloco SISTEMA — configurações, acessível pelo rodapé em ambos os módulos. */
const SISTEMA: Secao[] = [
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

type Modulo = "operacional" | "financeiro";
type Vista = Modulo | "sistema";

const VISTAS: Record<Vista, Secao[]> = { operacional: OPERACIONAL, financeiro: FINANCEIRO, sistema: SISTEMA };

const baseHref = (i: Item) => i.matchHref ?? i.href.split("#")[0];

/** Todas as bases de rota marcadas com sua vista (para descobrir a qual módulo uma rota pertence). */
const BASES_POR_VISTA: { base: string; vista: Vista }[] = (Object.keys(VISTAS) as Vista[]).flatMap((vista) =>
  VISTAS[vista].flatMap((s) => s.entries.flatMap((e) => (ehGrupo(e) ? e.itens : [e]).map((i) => ({ base: baseHref(i), vista }))))
    .filter((b) => b.base !== "__nunca__"),
);

/** Descobre a vista (módulo) de uma rota pelo prefixo mais longo; null se não pertencer a nenhuma. */
function vistaDaRota(pathname: string): Vista | null {
  let melhor: { base: string; vista: Vista } | null = null;
  for (const b of BASES_POR_VISTA) {
    if (pathname === b.base || pathname.startsWith(b.base + "/")) {
      if (!melhor || b.base.length > melhor.base.length) melhor = b;
    }
  }
  return melhor?.vista ?? null;
}

interface SidebarProps {
  session: Session;
  variant?: "desktop" | "mobile";
  avatarUrl?: string | null;
}

export function Sidebar({ session, variant = "desktop", avatarUrl }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const usuario = session.user;

  // Recolher/expandir (apenas desktop) — persistido em localStorage
  const [recolhido, setRecolhido] = useState(false);
  const [montado, setMontado] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  // Módulo ativo ("mundo") + overlay de configurações (Sistema)
  const [modulo, setModulo] = useState<Modulo>("operacional");
  const [sistemaAberto, setSistemaAberto] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (localStorage.getItem(STORAGE_KEY) === "1") setRecolhido(true);
      const m = localStorage.getItem(MODULO_KEY);
      if (m === "financeiro" || m === "operacional") setModulo(m);
    }
    setMontado(true);
  }, []);

  // Troca automática de vista conforme a rota atual (o menu segue a página).
  useEffect(() => {
    const v = vistaDaRota(pathname);
    if (v === "sistema") setSistemaAberto(true);
    else if (v) { setModulo(v); setSistemaAberto(false); }
  }, [pathname]);

  // Persiste o módulo escolhido
  useEffect(() => {
    if (montado) { try { localStorage.setItem(MODULO_KEY, modulo); } catch {} }
  }, [modulo, montado]);

  const toggleRecolher = () =>
    setRecolhido((v) => {
      const novo = !v;
      try { localStorage.setItem(STORAGE_KEY, novo ? "1" : "0"); } catch {}
      return novo;
    });

  const colapsada = variant === "desktop" && recolhido;

  // Permissão de visualização por item (item.modulo sobrescreve o 1º segmento da rota)
  const permissoes = (usuario as any).permissoes;
  const role = usuario.role;
  const podeVer = (i: Item) => {
    const m = i.modulo ?? moduloDaRota(i.href.split("#")[0]);
    return !m || pode(permissoes, m, "visualizar", role);
  };

  // Filtra seções por permissão (itens sem permissão somem; grupos/seções vazios somem)
  const filtrar = (secoes: Secao[]) =>
    secoes.map((sec) => {
      const entries = sec.entries
        .map((e) => {
          if (!ehGrupo(e)) return podeVer(e) ? e : null;
          const itens = e.itens.filter((i) => podeVer(i));
          return itens.length > 0 ? { ...e, itens } : null;
        })
        .filter(Boolean) as (Item | Grupo)[];
      return { ...sec, entries };
    }).filter((sec) => sec.entries.length > 0);

  const temItens = (secoes: Secao[]) => secoes.some((s) => s.entries.length > 0);

  // Disponibilidade de cada mundo conforme RBAC
  const operacionalDisponivel = temItens(filtrar(OPERACIONAL));
  const financeiroDisponivel = temItens(filtrar(FINANCEIRO));
  const sistemaDisponivel = temItens(filtrar(SISTEMA));

  // Módulo efetivo (cai para o disponível se o escolhido não estiver acessível)
  const moduloEfetivo: Modulo =
    modulo === "financeiro" && !financeiroDisponivel ? "operacional"
      : modulo === "operacional" && !operacionalDisponivel && financeiroDisponivel ? "financeiro"
        : modulo;
  const vistaAtiva: Vista = sistemaAberto && sistemaDisponivel ? "sistema" : moduloEfetivo;

  const secoesVisiveis = filtrar(VISTAS[vistaAtiva]);
  const mostrarSeletor = operacionalDisponivel && financeiroDisponivel;

  // Tema por módulo: financeiro = azul royal (estilo Conta Azul); demais = navy padrão.
  // Destaque de item ativo adaptável ao fundo (overlay branco no financeiro).
  const temaFin = vistaAtiva === "financeiro";
  const ativoBg = temaFin ? "bg-white/20" : "bg-primary-500";

  // Item ativo pelo prefixo mais longo dentro da vista atual
  const basesAtuais = secoesVisiveis.flatMap((s) =>
    s.entries.flatMap((e) => (ehGrupo(e) ? e.itens : [e]).map((i) => baseHref(i))),
  ).filter((b) => b !== "__nunca__");
  let ativoHref: string | null = null;
  for (const b of basesAtuais) {
    if (pathname === b || pathname.startsWith(b + "/")) {
      if (!ativoHref || b.length > ativoHref.length) ativoHref = b;
    }
  }
  const itemAtivo = (i: Item) => baseHref(i) === ativoHref;
  const grupoAtivo = (g: Grupo) => g.itens.some((i) => itemAtivo(i));

  // Estado de expansão dos grupos — accordion: no máximo um grupo aberto por vez
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const toggle = (label: string) =>
    setAbertos((p) => (p.has(label) ? new Set() : new Set([label])));

  // Ao carregar/navegar, mantém aberto apenas o grupo que contém a rota ativa
  useEffect(() => {
    let alvo: string | null = null;
    for (const sec of VISTAS[vistaAtiva]) {
      for (const e of sec.entries) {
        if (ehGrupo(e) && e.itens.some((i) => baseHref(i) === ativoHref)) alvo = e.label;
      }
    }
    setAbertos(alvo ? new Set([alvo]) : new Set());
  }, [ativoHref, vistaAtiva]);

  const escolherModulo = (m: Modulo) => {
    setModulo(m);
    setSistemaAberto(false);
    router.push(m === "financeiro" ? "/financeiro" : "/dashboard");
  };

  return (
    <aside
      style={temaFin ? { backgroundColor: "#14498F" } : undefined}
      className={cn(
        "flex flex-col bg-sidebar text-white shrink-0 shadow-xl",
        montado && "transition-[width,background-color] duration-200 ease-in-out",
        variant === "mobile" ? "w-72 h-full" : cn("hidden lg:flex", colapsada ? "lg:w-16" : "lg:w-[280px]"),
      )}
    >
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

      {/* Seletor de módulos ("mundos") */}
      {mostrarSeletor && (
        <div className={cn("px-3 pt-3", colapsada ? "pb-1" : "pb-1")}>
          <div className={cn("bg-white/5 rounded-xl p-1", colapsada ? "flex flex-col gap-1" : "grid grid-cols-2 gap-1")}>
            <SeletorBotao
              ativo={vistaAtiva === "operacional"}
              ativoBg={ativoBg}
              onClick={() => escolherModulo("operacional")}
              icone={Wrench}
              label="Operacional"
              colapsada={colapsada}
            />
            <SeletorBotao
              ativo={vistaAtiva === "financeiro"}
              ativoBg={ativoBg}
              onClick={() => escolherModulo("financeiro")}
              icone={Coins}
              label="Financeiro"
              colapsada={colapsada}
            />
          </div>
        </div>
      )}

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
                        grupoAtivo(e) ? cn(ativoBg, "text-white") : "text-slate-200 hover:bg-white/5 hover:text-white",
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
                            ? cn(ativoBg, "text-white font-semibold")
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
                        <div className="mt-1 ml-3 pl-3 pr-1 py-1 rounded-lg bg-white/5 border-l-2 border-white/15 space-y-0.5">
                          {e.itens.map((i) => (
                            <Link
                              key={i.href + i.label}
                              href={i.href}
                              className={cn(
                                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                                itemAtivo(i)
                                  ? "bg-white/15 text-white font-medium"
                                  : "text-slate-200 hover:bg-white/10 hover:text-white",
                              )}
                            >
                              <i.icone className="w-4 h-4 shrink-0" />
                              {i.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <SidebarLink key={e.href} href={e.href} icone={e.icone} label={e.label} ativo={itemAtivo(e)} ativoBg={ativoBg} colapsada={colapsada} />
                ),
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Rodapé: configurações (Sistema) + instalar app + logo */}
      <div className="px-3 pt-2 pb-3 border-t border-white/5 space-y-2">
        {sistemaDisponivel && (
          <button
            onClick={() => setSistemaAberto((v) => !v)}
            title={colapsada ? "Configurações" : undefined}
            className={cn(
              "flex items-center rounded-lg text-sm transition-colors w-full",
              colapsada ? "justify-center py-2" : "gap-3 pl-4 pr-3 py-2.5",
              sistemaAberto
                ? cn(ativoBg, "text-white font-semibold")
                : "text-slate-200 hover:bg-white/5 hover:text-white",
            )}
          >
            <Settings className="w-[18px] h-[18px] shrink-0" />
            {!colapsada && <span className="truncate">Configurações</span>}
          </button>
        )}
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

interface SeletorBotaoProps {
  ativo: boolean;
  ativoBg: string;
  onClick: () => void;
  icone: Icone;
  label: string;
  colapsada: boolean;
}

function SeletorBotao({ ativo, ativoBg, onClick, icone: Icone, label, colapsada }: SeletorBotaoProps) {
  return (
    <button
      onClick={onClick}
      title={colapsada ? label : undefined}
      className={cn(
        "flex items-center justify-center rounded-lg text-xs font-medium transition-all",
        colapsada ? "py-2" : "gap-1.5 py-2 px-2",
        ativo
          ? cn(ativoBg, "text-white shadow-sm")
          : "text-slate-300 hover:bg-white/5 hover:text-white",
      )}
    >
      <Icone className={cn(colapsada ? "w-[18px] h-[18px]" : "w-4 h-4 shrink-0")} />
      {!colapsada && <span className="truncate">{label}</span>}
    </button>
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
  ativoBg: string;
  colapsada: boolean;
}

function SidebarLink({ href, icone: Icone, label, ativo, ativoBg, colapsada }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      title={colapsada ? label : undefined}
      className={cn(
        "relative flex items-center rounded-lg text-sm transition-all",
        colapsada ? "justify-center py-2.5" : "gap-3 pl-4 pr-3 py-2.5",
        ativo
          ? cn(ativoBg, "text-white font-semibold shadow-sm")
          : "text-slate-200 hover:bg-white/5 hover:text-white",
      )}
    >
      {ativo && !colapsada && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-success-500" />}
      <Icone className="w-[18px] h-[18px] shrink-0" />
      {!colapsada && <span className="truncate">{label}</span>}
    </Link>
  );
}
