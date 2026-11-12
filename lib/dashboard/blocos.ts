/**
 * Catálogo dos blocos do dashboard — arquivo puro (servidor e client).
 * Cada bloco declara a permissão necessária: quem não a tem nem vê o bloco
 * (e o servidor nem roda as consultas dele).
 */
import { pode, type Permissoes } from "@/lib/permissoes";

export type BlocoId =
  | "operacional" | "os-do-dia" | "solicitacoes" | "agenda"
  | "comercial" | "financeiro" | "equipamentos" | "frota" | "prazos";

export interface BlocoDef {
  id: BlocoId;
  titulo: string;
  descricao: string;
  /** Ocupa a largura toda no desktop (senão, meia coluna). */
  largo?: boolean;
  /** Quem pode ver (recebe as permissões e o role do usuário). */
  visivel: (p: Permissoes | undefined, role?: string) => boolean;
}

export const BLOCOS: BlocoDef[] = [
  {
    id: "operacional", titulo: "Operacional", largo: true,
    descricao: "OS abertas, agendadas hoje, atrasadas e concluídas no mês",
    visivel: (p, r) => pode(p, "ordens", "visualizar", r),
  },
  {
    id: "os-do-dia", titulo: "OS do dia por técnico",
    descricao: "Atividades de hoje de cada técnico/equipe",
    visivel: (p, r) => pode(p, "ordens", "visualizar", r),
  },
  {
    id: "solicitacoes", titulo: "Solicitações pendentes",
    descricao: "Chamados do portal e do QR Code aguardando atendimento",
    visivel: (p, r) => pode(p, "ordens", "visualizar", r),
  },
  {
    id: "agenda", titulo: "Agenda", largo: true,
    descricao: "Próximos 14 dias e próximas OS agendadas",
    visivel: (p, r) => pode(p, "calendario", "visualizar", r) || pode(p, "ordens", "visualizar", r),
  },
  {
    id: "comercial", titulo: "Comercial",
    descricao: "Contratos ativos e vencendo, orçamentos em aberto",
    visivel: (p, r) => pode(p, "contratos", "visualizar", r) || pode(p, "orcamentos", "visualizar", r),
  },
  {
    id: "financeiro", titulo: "Financeiro",
    descricao: "Faturado e recebido no mês, a receber, vencidos e próximos 7 dias",
    visivel: (p, r) => pode(p, "financeiro", "visualizar", r) && pode(p, "financeiro", "contasReceber", r),
  },
  {
    id: "equipamentos", titulo: "Equipamentos",
    descricao: "Total cadastrado e garantias vencendo",
    visivel: (p, r) => pode(p, "equipamentos", "visualizar", r),
  },
  {
    id: "frota", titulo: "Frota",
    descricao: "Veículos em manutenção, checklists pendentes, documentos e revisões",
    visivel: (p, r) => pode(p, "veiculos", "visualizar", r),
  },
  {
    id: "prazos", titulo: "Prazos e SLA",
    descricao: "Etapas vencidas, vencendo hoje e compras pendentes",
    visivel: (p, r) => pode(p, "ordens", "visualizar", r),
  },
];

const IDS = new Set<string>(BLOCOS.map((b) => b.id));

/** Blocos que o perfil pode ver, na ordem padrão. */
export function blocosPermitidos(p: Permissoes | undefined, role?: string): BlocoDef[] {
  return BLOCOS.filter((b) => b.visivel(p, role));
}

/** Preferência do usuário (por dispositivo, em cookie): ordem e blocos ocultos. */
export interface PreferenciaDashboard { ordem: BlocoId[]; ocultos: BlocoId[] }

export const COOKIE_DASHBOARD = "frivo_dashboard";
export const PREF_PADRAO: PreferenciaDashboard = { ordem: BLOCOS.map((b) => b.id), ocultos: [] };

/** Lê o cookie com tolerância: valor inválido/antigo vira o padrão; ids desconhecidos somem. */
export function lerPreferencia(valor: string | undefined | null): PreferenciaDashboard {
  if (!valor) return PREF_PADRAO;
  try {
    const bruto = JSON.parse(decodeURIComponent(valor));
    const limpa = (xs: unknown): BlocoId[] =>
      Array.isArray(xs) ? [...new Set(xs.filter((x): x is BlocoId => typeof x === "string" && IDS.has(x)))] : [];
    return { ordem: limpa(bruto?.ordem), ocultos: limpa(bruto?.ocultos) };
  } catch {
    return PREF_PADRAO;
  }
}

export function serializarPreferencia(p: PreferenciaDashboard): string {
  return encodeURIComponent(JSON.stringify({ ordem: p.ordem, ocultos: p.ocultos }));
}

/**
 * Lista final de blocos a mostrar: só os permitidos, na ordem do usuário
 * (blocos novos que ele ainda não ordenou entram no fim), sem os ocultos.
 */
export function aplicarPreferencia(permitidos: BlocoDef[], pref: PreferenciaDashboard) {
  const pos = new Map(pref.ordem.map((id, i) => [id, i]));
  const ordenados = [...permitidos].sort((a, b) => {
    const pa = pos.get(a.id) ?? Infinity;
    const pb = pos.get(b.id) ?? Infinity;
    if (pa !== pb) return pa - pb;
    return BLOCOS.indexOf(a) - BLOCOS.indexOf(b);
  });
  return { todos: ordenados, visiveis: ordenados.filter((b) => !pref.ocultos.includes(b.id)) };
}
