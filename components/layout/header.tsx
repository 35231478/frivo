"use client";

import { useNomesDaTrilha } from "@/components/layout/nome-na-trilha";
import { signOut } from "next-auth/react";
import { IconeConversas } from "@/components/chat/icone-conversas";
import { Bell, ShieldX, ChevronRight, LogOut, Search, AlertTriangle, Clock, ShoppingCart, Headset, ClipboardCheck, FileWarning, Wrench, Menu, Barcode, MessageSquareReply, PackageCheck, FileCheck2, FileX2, Hourglass, CalendarX2, TrendingUp, PackageOpen, PackageMinus, Globe, BadgeCheck, MessageSquareWarning, StarOff, UserPlus, FileSignature } from "lucide-react";
import Link from "next/link";
import { hrefChecklistsComAlertas, hrefDocumentosVencendo, hrefLeadsSite, umOuLista } from "@/lib/alertas/destinos-sino";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "next-auth";
import { pode } from "@/lib/permissoes";
import { EVENTO_SINO } from "@/lib/ui/sino";
import type { ContagemSino } from "@/lib/alertas/sino-server";
import { avisoDoItem, escopoDoItem, itemPendencia, type IdPendencia } from "@/lib/alertas/pendencias";
import { assinaturaDoAviso, type AvisoDoNumero } from "@/lib/alertas/lidos";
import { URL_SOLICITACOES } from "@/lib/solicitacoes";
import { FILTRO_AGUARDANDO_PEDIDO } from "@/lib/pedido-cliente/where";
import { escopoDoSino } from "@/lib/alertas/sino";
import { COR_TOM, ICONE_PENDENCIA } from "@/components/alertas/icones-pendencia";

/**
 * A resposta de /api/alertas: a contagem do sino (lib/alertas/sino-server), sem as contas do dia (só o painel).
 * `total` é o número do sino (só o não lido); `totalGeral`, todos; `lidos`, os avisos lidos hoje (lib/alertas/lidos).
 */
type Alertas = Omit<ContagemSino, "foraDoNumero"> & { totalGeral?: number; lidos?: AvisoDoNumero[] };

interface HeaderProps {
  session: Session;
  avatarUrl?: string | null;
}

const ROTULOS_ROTA: Record<string, string> = {
  dashboard: "Dashboard",
  clientes: "Clientes",
  equipamentos: "Equipamentos",
  pmoc: "PMOC",
  ordens: "Ordens de serviço",
  contratos: "Contratos",
  "faturamento-contratos": "Faturamento de contratos",
  tecnicos: "Técnicos",
  colaboradores: "Colaboradores",
  admissoes: "Admissões",
  "documentacao-equipe": "Documentação da equipe",
  equipes: "Equipes",
  "app-colaborador": "App do colaborador",
  desempenho: "Desempenho",
  revisao: "A revisar",
  premiacoes: "Premiação",
  configuracao: "Configuração",
  fechamento: "Fechamento",
  veiculos: "Veículos",
  checklist: "Checklist",
  cargos: "Cargos",
  "checklists-veiculo": "Checklists de veículo",
  "contas-bancarias": "Contas bancárias",
  faturas: "Faturas",
  perfil: "Meu Perfil",
  configuracoes: "Configurações",
  formularios: "Formulários",
  produtos: "Produtos",
  servicos: "Serviços",
  "tipos-equipamento": "Tipos de equipamento",
  "tabelas-preco": "Tabelas de preços",
  "tipos-os": "Tipos de OS",
  estoque: "Estoque",
  notas: "Notas de compra",
  separacao: "A separar",
  devolucao: "A devolver",
  "impressao-os": "Impressão da OS",
  financeiro: "Financeiro",
  "custo-pessoal": "Custo de pessoal",
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
  "despesas-campo": "Despesas de campo",
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
  etapas: "Etapas com prazo",
  templates: "Modelos",
  termos: "Termos",
  "termos-referencia": "Termos de referência",
  "modelos-prazo": "Etapas com prazo",
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
  pendencias: "Pendências",
};

/** Segmento da URL que é o id de um registro (cuid ou hex), não uma palavra da rota */
export const ehIdDeRegistro = (seg: string) => /^[0-9a-f]{8,}/i.test(seg) || /^c[a-z0-9]{20,}$/.test(seg);

/**
 * A trilha do topo. Um id na URL vira o NOME do registro quando a página o informou (NomeNaTrilha:
 * cliente, OS com número, orçamento com número); sem nome, "Detalhes", como antes.
 */
export function gerarBreadcrumb(pathname: string, nomes: ReadonlyMap<string, string> = new Map()) {
  const segs = pathname.split("/").filter(Boolean);
  const itens: { label: string; href: string }[] = [];
  let acc = "";
  for (const seg of segs) {
    acc += "/" + seg;
    const label =
      ROTULOS_ROTA[seg] ??
      (ehIdDeRegistro(seg) ? nomes.get(seg) ?? "Detalhes" : seg.charAt(0).toUpperCase() + seg.slice(1));
    itens.push({ label, href: acc });
  }
  return itens;
}

export function Header({ session, avatarUrl }: HeaderProps) {
  const usuario = session.user;
  // Atalhos do sino seguem o RBAC: cada item só aparece para quem pode abrir o destino (T1)
  const podeVer = (modulo: string, acao?: string) => pode(usuario.permissoes, modulo, (acao as never) ?? "visualizar", usuario.role);
  const pathname = usePathname();
  const nomesTrilha = useNomesDaTrilha();
  // o Map é o mesmo objeto: o tamanho entra na dependência para redesenhar quando um nome chega
  const breadcrumb = useMemo(() => gerarBreadcrumb(pathname, nomesTrilha), [pathname, nomesTrilha, nomesTrilha.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [sinoAberto, setSinoAberto] = useState(false);
  const sinoRef = useRef<HTMLDivElement>(null);
  // Os itens que também estão no painel de pendências: rótulo, ícone e destino do catálogo (lib/alertas/pendencias).
  // O servidor já zera o que a pessoa não pode ver; a tela confere de novo pela mesma regra (escopoDoSino).
  // `sempre` mostra mesmo com 0.
  const escopo = useMemo(() => escopoDoSino({ permissoes: usuario.permissoes, role: usuario.role, restrito: false }), [usuario.permissoes, usuario.role]);
  const doPainel = (id: IdPendencia, sempre = false) => {
    if (!alertas || !escopo[escopoDoItem(id)]) return null;
    const i = itemPendencia(id, alertas);
    if (!sempre && i.valor <= 0) return null;
    return <AlertaItem href={i.href} icone={ICONE_PENDENCIA[i.icone]} cor={COR_TOM[i.tom]} label={i.rotulo} valor={i.valor} {...toque(avisoDoItem(id))} />;
  };
  // O TOQUE num aviso: fecha o sino, marca o aviso como lido (o número cai na hora) e vai para o destino.
  // A marca é gravada no servidor (/api/alertas/lidos, com keepalive: a navegação não a corta).
  const lidos = new Set(alertas?.lidos ?? []);
  const toque = (campo: AvisoDoNumero | null) => ({
    lido: !!campo && lidos.has(campo),
    onClick: () => {
      setSinoAberto(false);
      if (!campo || !alertas || lidos.has(campo)) return;
      const valor = Number(alertas[campo]) || 0;
      if (valor <= 0) return;
      const assinatura = assinaturaDoAviso(alertas, campo);
      setAlertas((a) => (a ? { ...a, total: Math.max(0, a.total - valor), lidos: [...(a.lidos ?? []), campo] } : a));
      fetch("/api/alertas/lidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campo, assinatura }), keepalive: true }).catch(() => {});
    },
  });

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
    // Uma tela acabou de dar um aviso por visto (ex.: abriu a OS que o cliente confirmou): o sino relê já
    window.addEventListener(EVENTO_SINO, carregar);
    return () => {
      ativo = false;
      clearInterval(intervalo);
      window.removeEventListener(EVENTO_SINO, carregar);
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
  // A lista aparece enquanto houver aviso de pé, mesmo já lido (o lido fica apagado)
  const totalGeral = alertas?.totalGeral ?? total;
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
        {/* O nome da empresa não quebra em duas linhas (em ~1200 px virava "Clima / Total") */}
        <Link href="/dashboard" className="text-ink-muted hover:text-primary-600 transition-colors whitespace-nowrap truncate max-w-[14rem] shrink-0" data-trilha-empresa>
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
            placeholder="Pesquisar..."
            className="w-64 bg-surface-page border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:bg-white focus:border-acento focus:ring-4 focus:ring-acento/15 transition-colors"
          />
        </div>

        {/* CHAT-1: Conversas (quem vê OS), com as conversas por ler */}
        {(pode(usuario.permissoes, "ordens", "visualizar", usuario.role) || pode(usuario.permissoes, "conversas", "visualizar", usuario.role)) && <IconeConversas />}

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
              <Link href="/pendencias" onClick={() => setSinoAberto(false)} data-sino-pendencias
                className="flex items-center justify-between px-4 py-2.5 text-sm font-medium text-acento hover:bg-surface-alt border-b border-surface-border transition-colors">
                Ver pendências de hoje <ChevronRight className="w-4 h-4" aria-hidden />
              </Link>
              {totalGeral === 0 ? (
                <p className="text-sm text-ink-muted text-center py-6">Nenhum alerta no momento.</p>
              ) : (
                <div className="divide-y divide-surface-linha">
                  {podeVer("orcamentos") && (alertas?.leadsSite ?? 0) > 0 && <AlertaItem href={hrefLeadsSite(alertas?.leadsSite, alertas?.leadSiteId)} icone={Globe} cor="text-primary-600" label="Novos leads do site" valor={alertas?.leadsSite ?? 0} {...toque("leadsSite")} />}
                  {podeVer("orcamentos") && <AlertaItem href={umOuLista(alertas?.orcamentosRespondidos, alertas?.orcamentoRespondidoId, (id) => `/orcamentos/${id}`, "/orcamentos?resposta=nova&periodo=todos")} icone={MessageSquareReply} cor="text-acento" label="Respostas de orçamentos" valor={alertas?.orcamentosRespondidos ?? 0} {...toque("orcamentosRespondidos")} />}
                  {doPainel("orcamentosVencendo")}
                  {/* Aceite do cliente: confirmou pelo link (ou assinou com o técnico) e ninguém abriu a OS ainda; a ressalva primeiro */}
                  {podeVer("ordens") && (alertas?.avaliacoesBaixas ?? 0) > 0 && <AlertaItem href={hrefOs(alertas?.avaliacaoBaixaOsId)} icone={StarOff} cor="text-atrasado" label="Avaliações baixas do cliente" valor={alertas?.avaliacoesBaixas ?? 0} {...toque("avaliacoesBaixas")} />}
                  {podeVer("ordens") && (alertas?.aceitesRessalva ?? 0) > 0 && <AlertaItem href={hrefOs(alertas?.aceiteRessalvaOsId)} icone={MessageSquareWarning} cor="text-atencao" label="Ressalvas de clientes" valor={alertas?.aceitesRessalva ?? 0} {...toque("aceitesRessalva")} />}
                  {podeVer("ordens") && (alertas?.aceitesConfirmados ?? 0) > 0 && <AlertaItem href={hrefOs(alertas?.aceiteConfirmadoOsId)} icone={BadgeCheck} cor="text-ok" label="Serviços confirmados pelo cliente" valor={alertas?.aceitesConfirmados ?? 0} {...toque("aceitesConfirmados")} />}
                  {podeVer("admissao", "gerenciar") && (alertas?.admissoesAssinadas ?? 0) > 0 && <AlertaItem href="/admissoes?situacao=ASSINADO" icone={UserPlus} cor="text-ok" label="Admissões assinadas" valor={alertas?.admissoesAssinadas ?? 0} {...toque("admissoesAssinadas")} />}
                  {/* NFS-e: só aparece quando há o que ver (resultado não visto ou nota parada) */}
                  {podeVer("financeiro", "fiscal") && (alertas?.nfseRejeitadas ?? 0) > 0 && <AlertaItem href={hrefMedicao(alertas?.nfseRejeitadaMedicaoId)} icone={FileX2} cor="text-atrasado" label="NFS-e não aceitas" valor={alertas?.nfseRejeitadas ?? 0} {...toque("nfseRejeitadas")} />}
                  {podeVer("financeiro", "fiscal") && (alertas?.nfseAguardando ?? 0) > 0 && <AlertaItem href={hrefMedicao(alertas?.nfseAguardandoMedicaoId)} icone={Hourglass} cor="text-atencao" label="NFS-e aguardando a prefeitura" valor={alertas?.nfseAguardando ?? 0} {...toque("nfseAguardando")} />}
                  {podeVer("financeiro", "fiscal") && (alertas?.nfseAutorizadas ?? 0) > 0 && <AlertaItem href={hrefMedicao(alertas?.nfseAutorizadaMedicaoId)} icone={FileCheck2} cor="text-ok" label="NFS-e autorizadas" valor={alertas?.nfseAutorizadas ?? 0} {...toque("nfseAutorizadas")} />}
                  {podeVer("financeiro", "medicoes") && (alertas?.faturamentoContratos ?? 0) > 0 && <AlertaItem href="/financeiro/faturamento-contratos?atencao=1" icone={CalendarX2} cor="text-atrasado" label="Faturamento de contrato parado" valor={alertas?.faturamentoContratos ?? 0} {...toque("faturamentoContratos")} />}
                  {podeVer("contratos", "editar") && (alertas?.reajustesContrato ?? 0) > 0 && <AlertaItem href="/contratos/reajustes" icone={TrendingUp} cor="text-atencao" label="Reajustes a aplicar" valor={alertas?.reajustesContrato ?? 0} {...toque("reajustesContrato")} />}
                  {podeVer("pmoc") && (alertas?.pmocsExpirados ?? 0) > 0 && <AlertaItem href="/pmoc?status=EXPIRADO" icone={ShieldX} cor="text-atrasado" label="PMOC expirados" valor={alertas?.pmocsExpirados ?? 0} {...toque("pmocsExpirados")} />}
                  {doPainel("pmocsVencendo")}
                  {podeVer("estoque", "separar") && (alertas?.separacoesPendentes ?? 0) > 0 && <AlertaItem href="/estoque/separacao" icone={PackageOpen} cor="text-acento" label="OS com material a separar" valor={alertas?.separacoesPendentes ?? 0} {...toque("separacoesPendentes")} />}
                  {podeVer("estoque", "separar") && (alertas?.devolucoesPendentes ?? 0) > 0 && <AlertaItem href="/estoque/devolucao" icone={PackageMinus} cor="text-atencao" label="OS com material a devolver" valor={alertas?.devolucoesPendentes ?? 0} {...toque("devolucoesPendentes")} />}
                  {doPainel("despesasCampo")}
                  {/* Pedido do cliente: OS esperando o pedido há mais que o prazo da empresa (Configurações › Orçamentos e propostas) */}
                  {podeVer("ordens") && (alertas?.pedidosAtrasados ?? 0) > 0 && <AlertaItem
                    href={umOuLista(alertas?.pedidosAtrasados, alertas?.pedidoAtrasadoOsId, (id) => `/ordens/${id}`, `/ordens?pedido=${FILTRO_AGUARDANDO_PEDIDO}&periodo=todos&sort=criadoEm&dir=asc`)}
                    icone={FileSignature} cor="text-atencao" label={`Pedido do cliente há mais de ${alertas?.diasAlertaPedido ?? 7} dias`} valor={alertas?.pedidosAtrasados ?? 0} {...toque("pedidosAtrasados")} />}
                  {/* PC-2: o comprador anexou o pedido de compra no portal; o escritório confere (confirmar libera o faturamento) */}
                  {doPainel("pedidosConferir")}
                  {doPainel("comentariosCampo")}
                  {doPainel("atividadesEsquecidas")}
                  {doPainel("impedimentosAbertos")}
                  {doPainel("visitasNaoConcluidas")}
                  {doPainel("estoqueNegativoCampo")}
                  {(alertas?.nfPedidos ?? 0) > 0 && <AlertaItem href={umOuLista(alertas?.nfPedidos, alertas?.nfPedidoId, (id) => `/compras/pedidos/${id}`, "/compras/pedidos?periodo=todos")} icone={PackageCheck} cor="text-ok" label="NF chegou nos seus pedidos" valor={alertas?.nfPedidos ?? 0} {...toque("nfPedidos")} />}
                  {podeVer("ordens") && <AlertaItem href="/ordens/etapas?status=ATRASADO" icone={AlertTriangle} cor="text-atrasado" label="Etapas com prazo vencidas" valor={alertas?.prazosVencidos ?? 0} {...toque("prazosVencidos")} />}
                  {podeVer("ordens") && <AlertaItem href="/ordens/etapas?status=ATIVO" icone={Clock} cor="text-atencao" label="Etapas vencendo hoje" valor={alertas?.etapasVencendoHoje ?? 0} {...toque("etapasVencendoHoje")} />}
                  {podeVer("compras") && <AlertaItem href="/compras/pedidos?abertos=1" icone={ShoppingCart} cor="text-atencao" label="Compras pendentes" valor={alertas?.pedidosPendentes ?? 0} {...toque("pedidosPendentes")} />}
                  {podeVer("ordens") && <AlertaItem href={URL_SOLICITACOES} icone={Headset} cor="text-acento" label="Chamados do portal" valor={alertas?.chamadosPortal ?? 0} {...toque("chamadosPortal")} />}
                  {doPainel("osSemTecnico")}
                  {doPainel("osAtrasadas", true)}
                  {/* Prazo de ATENDIMENTO do contrato (comparecer / resolver) — não é o prazo de execução da OS. Só aparece quando há o que ver */}
                  {podeVer("ordens") && (alertas?.atendimentoEstourado ?? 0) > 0 && <AlertaItem href="/ordens?atendimento=estourado&periodo=todos" icone={Headset} cor="text-atrasado" label="Prazo de atendimento estourado" valor={alertas?.atendimentoEstourado ?? 0} {...toque("atendimentoEstourado")} />}
                  {podeVer("ordens") && (alertas?.atendimentoVencendo ?? 0) > 0 && <AlertaItem href="/ordens?atendimento=vencendo&periodo=todos" icone={Headset} cor="text-atencao" label="Prazo de atendimento vencendo" valor={alertas?.atendimentoVencendo ?? 0} {...toque("atendimentoVencendo")} />}
                  {podeVer("veiculos") && <AlertaItem href="/veiculos/checklist" icone={ClipboardCheck} cor="text-acento" label="Checklists pendentes" valor={alertas?.checklistPendente ?? 0} {...toque("checklistPendente")} />}
                  {podeVer("veiculos") && <AlertaItem href={hrefChecklistsComAlertas(alertas?.checklistsComAlertas, alertas?.checklistAlertaVeiculoId)} icone={AlertTriangle} cor="text-atencao" label="Checklists com alertas" valor={alertas?.checklistsComAlertas ?? 0} {...toque("checklistsComAlertas")} />}
                  {podeVer("veiculos") && (alertas?.checklistNaoVaiUsar ?? 0) > 0 && <AlertaItem href="/veiculos/checklist?aba=diario" icone={ClipboardCheck} cor="text-atencao" label="Não vão usar o veículo hoje" valor={alertas?.checklistNaoVaiUsar ?? 0} {...toque("checklistNaoVaiUsar")} />}
                  {podeVer("veiculos") && <AlertaItem href={hrefDocumentosVencendo(alertas?.documentosVencendo, alertas?.documentoVencendoVeiculoId)} icone={FileWarning} cor="text-atencao" label="Documentos de veículo vencendo" valor={alertas?.documentosVencendo ?? 0} {...toque("documentosVencendo")} />}
                  {podeVer("veiculos") && <AlertaItem href="/veiculos?status=manutencao" icone={Wrench} cor="text-acento" label="Veículos em manutenção" valor={alertas?.veiculosManutencao ?? 0} {...toque("veiculosManutencao")} />}
                  {podeVer("financeiro", "contasReceber") && <AlertaItem href="/financeiro/contas-receber?card=RECEBIDO&periodo=todos" icone={Barcode} cor="text-ok" label="Boletos pagos hoje" valor={alertas?.boletosPagos ?? 0} {...toque("boletosPagos")} />}
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
/** A OS do aviso mais recente: abrir a OS é o que dá o aviso por visto */
const hrefOs = (id: string | null | undefined) => (id ? `/ordens/${id}` : "/ordens");


function AlertaItem({
  href, icone: Icone, cor, label, valor, onClick, lido = false,
}: {
  href: string;
  icone: React.ComponentType<{ className?: string }>;
  cor: string;
  label: string;
  valor: number;
  onClick: () => void;
  /** Já tocado hoje: fica na lista, apagado, e fora do número do sino (lib/alertas/lidos) */
  lido?: boolean;
}) {
  const forte = valor > 0 && !lido;
  return (
    <Link href={href} onClick={onClick} data-sino-item={lido ? "lido" : forte ? "novo" : "zero"}
      title={lido ? "Lido hoje. Volta a contar se chegar um novo ou no dia seguinte, se ainda estiver pendente." : undefined}
      className={`flex items-center justify-between px-4 py-2.5 hover:bg-surface-alt transition-colors ${lido ? "opacity-60" : ""}`}>
      <span className={`flex items-center gap-2.5 text-sm ${lido ? "text-ink-muted" : "text-ink"}`}>
        <Icone className={`w-4 h-4 ${cor}`} />
        {label}
      </span>
      <span className={forte ? "text-sm font-bold text-ink" : "text-sm text-ink-subtle"}>{valor}</span>
    </Link>
  );
}
