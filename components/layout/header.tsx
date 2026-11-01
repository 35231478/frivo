"use client";

import { signOut } from "next-auth/react";
import { Bell, ChevronRight, LogOut, Search, AlertTriangle, Clock, ShoppingCart, Timer, Headset, ClipboardCheck, FileWarning, Wrench, Menu, Barcode, MessageSquareReply, PackageCheck, FileCheck2, FileX2, Hourglass, CalendarX2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "next-auth";
import { pode } from "@/lib/permissoes";

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
  boletosPagos: number;
  orcamentosRespondidos: number;
  nfPedidos: number;
  nfPedidoId: string | null;
  nfseAutorizadas?: number;
  nfseAutorizadaMedicaoId?: string | null;
  nfseRejeitadas?: number;
  nfseRejeitadaMedicaoId?: string | null;
  nfseAguardando?: number;
  nfseAguardandoMedicaoId?: string | null;
  faturamentoContratos?: number;
  total: number;
}

interface HeaderProps {
  session: Session;
  avatarUrl?: string | null;
}

const ROTULOS_ROTA: Record<string, string> = {
  dashboard: "Dashboard",
  clientes: "Clientes",
  equipamentos: "Equipamentos",
  ordens: "Ordens de Serviço",
  contratos: "Contratos",
  "faturamento-contratos": "Faturamento de contratos",
  tecnicos: "Técnicos",
  colaboradores: "Colaboradores",
  equipes: "Equipes",
  veiculos: "Veículos",
  checklist: "Checklist",
  cargos: "Cargos",
  "checklists-veiculo": "Checklists de Veículo",
  "contas-bancarias": "Contas Bancárias",
  faturas: "Faturas",
  perfil: "Meu Perfil",
  configuracoes: "Configurações",
  formularios: "Formulários",
  produtos: "Produtos",
  servicos: "Serviços",
  "tipos-equipamento": "Tipos de Equipamento",
  "tabelas-preco": "Tabelas de Preços",
  "tipos-os": "Tipos de OS",
  estoque: "Estoque",
  notas: "Notas de compra",
  "impressao-os": "Impressão da OS",
  financeiro: "Financeiro",
  "custo-pessoal": "Custo de Pessoal",
  fiscal: "Dados fiscais",
  colaborador: "Colaborador",
  encargos: "Encargos",
  importar: "Importar",
  operacionais: "Operacionais",
  financeiras: "Financeiras",
  conta: "Conta",
  novo: "Novo",
  nova: "Nova",
  editar: "Editar",
  // UX-8 (G5): fim do segmento cru ("Medicoes", "Contas-pagar", "Fluxo-caixa") no breadcrumb
  medicoes: "Medições",
  "contas-pagar": "Contas a pagar",
  "contas-receber": "Contas a receber",
  "fluxo-caixa": "Fluxo de caixa",
  fornecedores: "Fornecedores",
  "centros-custo": "Centros de custo",
  categorias: "Categorias",
  compras: "Compras",
  pedidos: "Pedidos",
  orcamentos: "Orçamentos",
  calendario: "Calendário",
  atividades: "Atividades",
  prazos: "Prazos",
  templates: "Modelos",
  termos: "Termos",
  "termos-referencia": "Termos de referência",
  "modelos-prazo": "Modelos de prazo",
  perfis: "Perfis de acesso",
  "perfis-acesso": "Perfis de acesso",
  usuarios: "Usuários",
  integracoes: "Integrações",
  inter: "Banco Inter",
  "leads-site": "Leads do site",
  qrcodes: "QR Codes",
  "qr-code": "QR Code",
  relatorio: "Relatório",
  imprimir: "Imprimir",
  executar: "Executar",
  foto: "Foto",
  instalar: "Instalar",
  montador: "Montador",
  email: "E-mail",
  "formularios-por-tipo": "Formulários por tipo",
  portal: "Portal",
  "sem-permissao": "Sem permissão",
};

export function gerarBreadcrumb(pathname: string) {
  const segs = pathname.split("/").filter(Boolean);
  const itens: { label: string; href: string }[] = [];
  let acc = "";
  for (const seg of segs) {
    acc += "/" + seg;
    const label =
      ROTULOS_ROTA[seg] ??
      (/^[0-9a-f]{8,}/i.test(seg) || /^c[a-z0-9]{20,}$/.test(seg) ? "Detalhes" : seg.charAt(0).toUpperCase() + seg.slice(1));
    itens.push({ label, href: acc });
  }
  return itens;
}

export function Header({ session, avatarUrl }: HeaderProps) {
  const usuario = session.user;
  // Atalhos do sino seguem o RBAC: cada item só aparece para quem pode abrir o destino (T1)
  const podeVer = (modulo: string, acao?: string) => pode(usuario.permissoes, modulo, (acao as never) ?? "visualizar", usuario.role);
  const pathname = usePathname();
  const breadcrumb = useMemo(() => gerarBreadcrumb(pathname), [pathname]);

  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [sinoAberto, setSinoAberto] = useState(false);
  const sinoRef = useRef<HTMLDivElement>(null);

  // Carrega os alertas uma vez ao montar e revalida por polling (2 min).
  // Antes isso rodava a cada troca de rota ([pathname]), o que disparava ~16
  // queries + 2 updateMany no /api/alertas em toda navegação de menu.
  useEffect(() => {
    let ativo = true;
    const carregar = () =>
      fetch("/api/alertas")
        .then((r) => r.json())
        .then((d) => { if (ativo) setAlertas(d); })
        .catch(() => {});
    carregar();
    const intervalo = setInterval(carregar, 120000);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, []);

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
    <header className="bg-white border-b border-surface-border px-4 sm:px-6 py-3 flex items-center justify-between gap-4 shrink-0">
      {/* Hamburguer (mobile) */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("frivo:toggle-menu"))}
        className="lg:hidden -ml-1 p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt transition-colors touch-target"
        aria-label="Abrir menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Breadcrumb */}
      <nav className="hidden sm:flex items-center gap-1.5 text-sm min-w-0">
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
            className="w-64 bg-surface-page border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:bg-white focus:border-acento focus:ring-4 focus:ring-acento/15 transition-colors"
          />
        </div>

        {/* Notificações */}
        <div className="relative" ref={sinoRef}>
          <button
            onClick={() => setSinoAberto((v) => !v)}
            className="relative p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt transition-colors"
            title="Alertas"
          >
            <Bell className="w-5 h-5" />
            {total > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-atrasado text-white text-[10px] font-semibold tabular-nums rounded-full ring-2 ring-white flex items-center justify-center">
                {total > 99 ? "99+" : total}
              </span>
            )}
          </button>

          {sinoAberto && (
            <div data-sino-menu className="fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full mt-2 sm:w-80 max-h-[calc(100dvh-6rem)] overflow-y-auto bg-white border border-surface-border rounded-card shadow-elevated z-30">
              <div className="px-4 py-3 border-b border-surface-border">
                <p className="font-display text-sm font-semibold text-ink">Alertas</p>
              </div>
              {total === 0 ? (
                <p className="text-sm text-ink-muted text-center py-6">Nenhum alerta no momento.</p>
              ) : (
                <div className="divide-y divide-surface-linha">
                  {podeVer("orcamentos") && <AlertaItem href="/orcamentos?resposta=nova&periodo=todos" icone={MessageSquareReply} cor="text-acento" label="Respostas de orçamentos" valor={alertas?.orcamentosRespondidos ?? 0} onClick={() => setSinoAberto(false)} />}
                  {/* NFS-e: só aparece quando há o que ver (resultado não visto ou nota parada) */}
                  {podeVer("financeiro", "fiscal") && (alertas?.nfseRejeitadas ?? 0) > 0 && <AlertaItem href={hrefMedicao(alertas?.nfseRejeitadaMedicaoId)} icone={FileX2} cor="text-atrasado" label="NFS-e não aceitas" valor={alertas?.nfseRejeitadas ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("financeiro", "fiscal") && (alertas?.nfseAguardando ?? 0) > 0 && <AlertaItem href={hrefMedicao(alertas?.nfseAguardandoMedicaoId)} icone={Hourglass} cor="text-atencao" label="NFS-e aguardando a prefeitura" valor={alertas?.nfseAguardando ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("financeiro", "fiscal") && (alertas?.nfseAutorizadas ?? 0) > 0 && <AlertaItem href={hrefMedicao(alertas?.nfseAutorizadaMedicaoId)} icone={FileCheck2} cor="text-ok" label="NFS-e autorizadas" valor={alertas?.nfseAutorizadas ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("financeiro", "medicoes") && (alertas?.faturamentoContratos ?? 0) > 0 && <AlertaItem href="/financeiro/faturamento-contratos?atencao=1" icone={CalendarX2} cor="text-atrasado" label="Faturamento de contrato parado" valor={alertas?.faturamentoContratos ?? 0} onClick={() => setSinoAberto(false)} />}
                  {(alertas?.nfPedidos ?? 0) > 0 && <AlertaItem href={`/compras/pedidos/${alertas?.nfPedidoId ?? ""}`} icone={PackageCheck} cor="text-ok" label="NF chegou nos seus pedidos" valor={alertas?.nfPedidos ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("ordens") && <AlertaItem href="/prazos?status=ATRASADO" icone={AlertTriangle} cor="text-atrasado" label="Prazos vencidos" valor={alertas?.prazosVencidos ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("ordens") && <AlertaItem href="/prazos?status=ATIVO" icone={Clock} cor="text-atencao" label="Vencendo hoje" valor={alertas?.etapasVencendoHoje ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("compras") && <AlertaItem href="/compras/pedidos" icone={ShoppingCart} cor="text-atencao" label="Compras pendentes" valor={alertas?.pedidosPendentes ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("ordens") && <AlertaItem href="/ordens?origem=PORTAL_CLIENTE" icone={Headset} cor="text-acento" label="Chamados do portal" valor={alertas?.chamadosPortal ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("ordens") && <AlertaItem href="/ordens" icone={Timer} cor="text-atrasado" label="Atendimentos em atraso" valor={alertas?.atendimentosAtraso ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("veiculos") && <AlertaItem href="/veiculos/checklist" icone={ClipboardCheck} cor="text-acento" label="Checklists pendentes" valor={alertas?.checklistPendente ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("veiculos") && <AlertaItem href="/veiculos" icone={AlertTriangle} cor="text-atencao" label="Checklists com alertas" valor={alertas?.checklistsComAlertas ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("veiculos") && <AlertaItem href="/veiculos" icone={FileWarning} cor="text-atencao" label="Documentos de veículo vencendo" valor={alertas?.documentosVencendo ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("veiculos") && <AlertaItem href="/veiculos" icone={Wrench} cor="text-acento" label="Veículos em manutenção" valor={alertas?.veiculosManutencao ?? 0} onClick={() => setSinoAberto(false)} />}
                  {podeVer("financeiro", "contasReceber") && <AlertaItem href="/financeiro/contas-receber?card=RECEBIDO&periodo=todos" icone={Barcode} cor="text-ok" label="Boletos pagos hoje" valor={alertas?.boletosPagos ?? 0} onClick={() => setSinoAberto(false)} />}
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
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={usuario.name ?? "Usuário"} className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-acento-claro text-acento flex items-center justify-center font-display text-xs font-semibold">
              {iniciais}
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-ink-muted hover:text-atrasado hover:bg-atrasado-claro transition-colors p-2 rounded-lg"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

/** A medição da nota mais recente (onde ficam as notas); sem ela, a lista de medições */
const hrefMedicao = (id: string | null | undefined) => (id ? `/financeiro/medicoes/${id}` : "/financeiro/medicoes");

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
