/**
 * Núcleo de controle de acesso por perfil (RBAC) do Frivo.
 * Arquivo puro (sem dependências de Node) — pode ser importado no servidor,
 * no client e no middleware (Edge).
 */

export type Acao =
  | "visualizar" | "criar" | "editar" | "excluir" | "concluir" | "aprovar"
  | "gerenciar" | "medicoes" | "contasReceber" | "fluxoCaixa" | "checklist" | "exportar";

export type Permissoes = Record<string, Partial<Record<Acao, boolean>>>;

export interface ModuloDef { id: string; label: string; icone: string; acoes: Acao[] }
export interface SecaoDef { id: string; label: string; modulos: ModuloDef[] }

export const ACOES_LABEL: Record<Acao, string> = {
  visualizar: "Visualizar",
  criar: "Criar",
  editar: "Editar",
  excluir: "Excluir",
  concluir: "Concluir",
  aprovar: "Aprovar",
  gerenciar: "Gerenciar",
  medicoes: "Medições",
  contasReceber: "Contas a Receber",
  fluxoCaixa: "Fluxo de Caixa",
  checklist: "Checklist",
  exportar: "Exportar",
};

/** Matriz de permissões agrupada por seção (fonte da verdade da UI e dos defaults). */
export const SECOES: SecaoDef[] = [
  {
    id: "operacao", label: "Operação", modulos: [
      { id: "ordens", label: "Ordens de Serviço", icone: "📋", acoes: ["visualizar", "criar", "editar", "concluir", "excluir"] },
      { id: "clientes", label: "Clientes", icone: "👥", acoes: ["visualizar", "criar", "editar", "excluir"] },
      { id: "equipamentos", label: "Equipamentos", icone: "🔧", acoes: ["visualizar", "criar", "editar", "excluir"] },
      { id: "calendario", label: "Calendário", icone: "📅", acoes: ["visualizar"] },
      { id: "qrcodes", label: "QR Codes", icone: "📊", acoes: ["visualizar", "gerenciar"] },
    ],
  },
  {
    id: "comercial", label: "Comercial", modulos: [
      { id: "orcamentos", label: "Orçamentos", icone: "💰", acoes: ["visualizar", "criar", "editar", "aprovar"] },
      { id: "contratos", label: "Contratos", icone: "📄", acoes: ["visualizar", "criar", "editar"] },
      { id: "licitacoes", label: "Licitações", icone: "🏛️", acoes: ["visualizar", "gerenciar"] },
    ],
  },
  {
    id: "financeiro", label: "Financeiro", modulos: [
      { id: "financeiro", label: "Financeiro", icone: "💵", acoes: ["visualizar", "medicoes", "contasReceber", "fluxoCaixa"] },
    ],
  },
  {
    id: "equipe", label: "Equipe", modulos: [
      { id: "equipes", label: "Equipes / Colaboradores", icone: "👤", acoes: ["visualizar", "gerenciar"] },
      { id: "veiculos", label: "Veículos", icone: "🚗", acoes: ["visualizar", "checklist", "gerenciar"] },
    ],
  },
  {
    id: "sistema", label: "Sistema", modulos: [
      { id: "configuracoes", label: "Configurações", icone: "⚙️", acoes: ["visualizar", "gerenciar"] },
      { id: "relatorios", label: "Relatórios", icone: "📈", acoes: ["visualizar", "exportar"] },
    ],
  },
];

/** Todos os módulos achatados (inclui "dashboard", sempre visualizável). */
export const MODULOS: ModuloDef[] = [
  { id: "dashboard", label: "Dashboard", icone: "🏠", acoes: ["visualizar"] },
  ...SECOES.flatMap((s) => s.modulos),
];

export function permissoesVazias(): Permissoes {
  const p: Permissoes = {};
  for (const m of MODULOS) { p[m.id] = {}; for (const a of m.acoes) p[m.id][a] = false; }
  p.dashboard = { visualizar: true }; // dashboard sempre liberado
  return p;
}

export function permissoesTotais(): Permissoes {
  const p: Permissoes = {};
  for (const m of MODULOS) { p[m.id] = {}; for (const a of m.acoes) p[m.id][a] = true; }
  return p;
}

/** Constrói um objeto de permissões a partir de um mapa parcial (resto = false). */
export function montarPermissoes(parcial: Record<string, Acao[]>): Permissoes {
  const p = permissoesVazias();
  for (const [modulo, acoes] of Object.entries(parcial)) {
    if (!p[modulo]) p[modulo] = {};
    for (const a of acoes) p[modulo][a] = true;
  }
  return p;
}

/**
 * Verifica permissão. Usuário com role ADMIN tem acesso total (administrador
 * master), independente do perfil.
 */
export function pode(
  permissoes: Permissoes | null | undefined,
  modulo: string,
  acao: Acao = "visualizar",
  role?: string,
): boolean {
  if (role === "ADMIN") return true;
  if (modulo === "dashboard") return true;
  if (!permissoes) return false;
  return permissoes[modulo]?.[acao] === true;
}

/** Mapeia o primeiro segmento da rota para um módulo de permissão. */
const ROTA_MODULO: Record<string, string> = {
  dashboard: "dashboard",
  clientes: "clientes",
  equipamentos: "equipamentos",
  ordens: "ordens",
  prazos: "ordens",
  calendario: "calendario",
  qrcodes: "qrcodes",
  orcamentos: "orcamentos",
  contratos: "contratos",
  licitacoes: "licitacoes",
  financeiro: "financeiro",
  equipes: "equipes",
  colaboradores: "equipes",
  veiculos: "veiculos",
  configuracoes: "configuracoes",
};

/** Retorna o módulo exigido para a rota, ou null se for rota sem gate de permissão. */
export function moduloDaRota(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return ROTA_MODULO[seg] ?? null;
}

/** Presets por tipo de perfil (usados no seed e como template ao escolher o tipo). */
export const PRESETS: Record<string, Permissoes> = {
  ADMINISTRADOR: permissoesTotais(),
  SUPERVISOR: montarPermissoes({
    dashboard: ["visualizar"],
    ordens: ["visualizar", "criar", "editar", "concluir", "excluir"],
    clientes: ["visualizar", "criar", "editar"],
    equipamentos: ["visualizar", "criar", "editar"],
    calendario: ["visualizar"],
    qrcodes: ["visualizar", "gerenciar"],
    equipes: ["visualizar", "gerenciar"],
    veiculos: ["visualizar", "checklist", "gerenciar"],
    relatorios: ["visualizar", "exportar"],
  }),
  FINANCEIRO: montarPermissoes({
    dashboard: ["visualizar"],
    clientes: ["visualizar"],
    ordens: ["visualizar"],
    orcamentos: ["visualizar", "criar", "editar", "aprovar"],
    contratos: ["visualizar", "criar", "editar"],
    licitacoes: ["visualizar", "gerenciar"],
    financeiro: ["visualizar", "medicoes", "contasReceber", "fluxoCaixa"],
    relatorios: ["visualizar", "exportar"],
  }),
  TECNICO: montarPermissoes({
    dashboard: ["visualizar"],
    ordens: ["visualizar", "criar", "editar", "concluir"],
    equipamentos: ["visualizar", "criar", "editar"],
    calendario: ["visualizar"],
    veiculos: ["visualizar", "checklist"],
    qrcodes: ["visualizar"],
  }),
  AUXILIAR: montarPermissoes({
    dashboard: ["visualizar"],
    ordens: ["visualizar"],
    equipamentos: ["visualizar"],
    calendario: ["visualizar"],
    veiculos: ["visualizar", "checklist"],
  }),
  PERSONALIZADO: permissoesVazias(),
};

export const CORES_PERFIL: Record<string, string> = {
  ADMINISTRADOR: "#EF4444",
  SUPERVISOR: "#F59E0B",
  FINANCEIRO: "#EAB308",
  TECNICO: "#0EA5E9",
  AUXILIAR: "#64748B",
  PERSONALIZADO: "#8B5CF6",
};

export const TIPOS_PERFIL_LABEL: Record<string, string> = {
  ADMINISTRADOR: "Administrador",
  SUPERVISOR: "Supervisor",
  FINANCEIRO: "Financeiro",
  TECNICO: "Técnico",
  AUXILIAR: "Auxiliar",
  PERSONALIZADO: "Personalizado",
};
