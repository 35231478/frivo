/**
 * Núcleo de controle de acesso por perfil (RBAC) do Frivo.
 * Arquivo puro (sem dependências de Node) — pode ser importado no servidor,
 * no client e no middleware (Edge). Só importa constantes de lib/ui/tokens.ts.
 */
import { corDado } from "@/lib/ui/tokens";

export type Acao =
  | "visualizar" | "criar" | "editar" | "excluir" | "concluir" | "aprovar"
  | "gerenciar" | "medicoes" | "contasReceber" | "fluxoCaixa" | "folha" | "fiscal" | "perdas" | "checklist" | "exportar"
  | "separar" | "revisar";

export type Permissoes = Record<string, Partial<Record<Acao, boolean>>>;

/** Nome do ícone (lucide-react) que representa o módulo na UI — este arquivo não importa a biblioteca. */
export type IconeModulo =
  | "ClipboardList" | "Users" | "Thermometer" | "CalendarDays" | "QrCode" | "Package" | "ShoppingCart" | "Calculator"
  | "FileText" | "Landmark" | "Wallet" | "UsersRound" | "Truck" | "Settings" | "BarChart3" | "LayoutDashboard" | "FileBadge" | "Trophy";
export interface ModuloDef { id: string; label: string; icone: IconeModulo; acoes: Acao[] }
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
  contasReceber: "Contas a receber",
  fluxoCaixa: "Fluxo de caixa",
  folha: "Custo de pessoal",
  fiscal: "Fiscal (NFS-e)",
  perdas: "Perdas (marcar/reverter)",
  checklist: "Checklist",
  exportar: "Exportar",
  separar: "Separar material",
  revisar: "Revisar penalidades",
};

/** Matriz de permissões agrupada por seção (fonte da verdade da UI e dos defaults). */
export const SECOES: SecaoDef[] = [
  {
    id: "operacao", label: "Operação", modulos: [
      { id: "ordens", label: "Ordens de serviço", icone: "ClipboardList", acoes: ["visualizar", "criar", "editar", "concluir", "excluir"] },
      { id: "clientes", label: "Clientes", icone: "Users", acoes: ["visualizar", "criar", "editar", "excluir"] },
      { id: "equipamentos", label: "Equipamentos", icone: "Thermometer", acoes: ["visualizar", "criar", "editar", "excluir"] },
      { id: "pmoc", label: "PMOC", icone: "FileBadge", acoes: ["visualizar", "criar", "editar", "excluir"] },
      { id: "calendario", label: "Calendário", icone: "CalendarDays", acoes: ["visualizar"] },
      { id: "qrcodes", label: "QR Codes", icone: "QrCode", acoes: ["visualizar", "gerenciar"] },
      // Estoque: ver saldos/extrato; gerenciar = lançar entrada, ajuste e inventário
      { id: "estoque", label: "Estoque", icone: "Package", acoes: ["visualizar", "gerenciar", "separar"] },
      // Compras: ver pedidos de compra, baixar/enviar o PC ao fornecedor; gerenciar = criar PC avulso,
      // editar e cancelar qualquer pedido. Só quem tem Compras pode ser o comprador responsável.
      { id: "compras", label: "Compras", icone: "ShoppingCart", acoes: ["visualizar", "gerenciar"] },
    ],
  },
  {
    id: "comercial", label: "Comercial", modulos: [
      { id: "orcamentos", label: "Orçamentos", icone: "Calculator", acoes: ["visualizar", "criar", "editar", "aprovar", "excluir"] },
      { id: "contratos", label: "Contratos", icone: "FileText", acoes: ["visualizar", "criar", "editar"] },
      { id: "licitacoes", label: "Licitações", icone: "Landmark", acoes: ["visualizar", "gerenciar"] },
    ],
  },
  {
    id: "financeiro", label: "Financeiro", modulos: [
      // "folha" = Custo de pessoal (RH): salários, benefícios, encargos e importação de colaboradores
      // "fiscal" = dados fiscais da empresa como emitente de NFS-e (certificado, regime, PlugNotas)
      // "perdas" = marcar uma cobrança como perda (inadimplência) e reverter — gerente/administrador
      { id: "financeiro", label: "Financeiro", icone: "Wallet", acoes: ["visualizar", "medicoes", "contasReceber", "fluxoCaixa", "folha", "fiscal", "perdas"] },
    ],
  },
  {
    id: "equipe", label: "Equipe", modulos: [
      { id: "equipes", label: "Equipes / Colaboradores", icone: "UsersRound", acoes: ["visualizar", "gerenciar", "excluir"] },
      { id: "veiculos", label: "Veículos", icone: "Truck", acoes: ["visualizar", "checklist", "gerenciar", "excluir"] },
      // Desempenho (manutenção): ver = painel, ranking e fichas; revisar = decidir "conta / não conta" na
      // lista de penalidades e registrar reclamação; gerenciar = configurar perfis, pesos, faixas, valores,
      // premiação e o link da TV (e ver os valores em reais)
      { id: "desempenho", label: "Desempenho", icone: "Trophy", acoes: ["visualizar", "revisar", "gerenciar"] },
    ],
  },
  {
    id: "sistema", label: "Sistema", modulos: [
      { id: "configuracoes", label: "Configurações", icone: "Settings", acoes: ["visualizar", "gerenciar"] },
      { id: "relatorios", label: "Relatórios", icone: "BarChart3", acoes: ["visualizar", "exportar"] },
    ],
  },
];

/** Todos os módulos achatados (inclui "dashboard", sempre visualizável). */
export const MODULOS: ModuloDef[] = [
  { id: "dashboard", label: "Dashboard", icone: "LayoutDashboard", acoes: ["visualizar"] },
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

/** "Financeiro › Fiscal (NFS-e)": nome da permissão como aparece no cadastro de perfis. */
export const rotuloPermissao = ([modulo, acao]: [string, Acao]) =>
  `${MODULOS.find((m) => m.id === modulo)?.label ?? modulo} › ${ACOES_LABEL[acao]}`;

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
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  if (modulo === "dashboard") return true;
  if (!permissoes) return false;
  return permissoes[modulo]?.[acao] === true;
}

/**
 * Permissões efetivas de um usuário no login:
 * - role ADMIN (administrador master) → acesso total;
 * - perfil de acesso ATIVO → permissões do perfil;
 * - sem perfil (ou perfil inativo) → nenhuma permissão além do dashboard.
 *   Antes, "sem perfil" liberava tudo — tirar o perfil de alguém deve restringir, não liberar.
 */
export function permissoesDoUsuario(usuario: {
  role?: string | null;
  perfilAcesso?: { ativo?: boolean | null; permissoes: unknown } | null;
}): Permissoes {
  if (usuario.role === "ADMIN" || usuario.role === "SUPER_ADMIN") return permissoesTotais();
  const perfil = usuario.perfilAcesso;
  if (!perfil || perfil.ativo === false || !perfil.permissoes || typeof perfil.permissoes !== "object") {
    return permissoesVazias();
  }
  return perfil.permissoes as Permissoes;
}

/**
 * Lista ("modulo.acao") das permissões de `alvo` que `base` NÃO tem. Vazia = alvo cabe em base.
 * Usada para impedir que alguém conceda (a si ou a outro) mais acesso do que ele mesmo tem.
 */
export function permissoesExcedentes(
  base: Permissoes | null | undefined,
  alvo: Permissoes | null | undefined,
  roleBase?: string,
): string[] {
  if (roleBase === "ADMIN") return [];
  const faltando: string[] = [];
  for (const [modulo, acoes] of Object.entries(alvo ?? {})) {
    if (modulo === "dashboard") continue;
    for (const [acao, ligado] of Object.entries(acoes ?? {})) {
      if (ligado === true && base?.[modulo]?.[acao as Acao] !== true) faltando.push(`${modulo}.${acao}`);
    }
  }
  return faltando;
}

/** Mapeia o primeiro segmento da rota para um módulo de permissão. */
const ROTA_MODULO: Record<string, string> = {
  dashboard: "dashboard",
  clientes: "clientes",
  equipamentos: "equipamentos",
  pmoc: "pmoc",
  ordens: "ordens",
  prazos: "ordens",
  mapa: "equipes", // Operações › Mapa (posição dos técnicos): a página exige Equipes › Gerenciar
  tecnico: "ordens", // app do técnico (Meu dia)
  calendario: "calendario",
  qrcodes: "qrcodes",
  orcamentos: "orcamentos",
  contratos: "contratos",
  licitacoes: "licitacoes",
  financeiro: "financeiro",
  equipes: "equipes",
  colaboradores: "equipes",
  desempenho: "desempenho",
  veiculos: "veiculos",
  estoque: "estoque",
  configuracoes: "configuracoes",
  compras: "compras",
  "leads-site": "orcamentos",   // leads do site são orçamentos (nome/WhatsApp/valores)
};

/** Retorna o módulo exigido para a rota, ou null se for rota sem gate de permissão. */
export function moduloDaRota(pathname: string): string | null {
  const segs = pathname.split("/").filter(Boolean);
  const seg = segs[0];
  if (!seg) return null;
  // Exceção: os modelos de checklist da frota moram em /configuracoes, mas o link fica no
  // grupo Frota — quem tem "veiculos" entra sem precisar de "configuracoes" (I3)
  if (seg === "configuracoes" && segs[1] === "checklists-veiculo") return "veiculos";
  // Exceção: o DETALHE de um pedido de compra decide sozinho quem entra (podeVerPedido: Compras,
  // comprador designado, quem pediu ou quem vê a OS/orçamento) — é para lá que o sino do
  // solicitante leva quando chega a NF do pedido dele (Compras 2/2)
  if (seg === "compras" && segs[1] === "pedidos" && segs.length === 3 && segs[2] !== "novo") return null;
  // Exceção (E4.1): a fila "A separar" e a tela de separação são de quem tem "Estoque › Separar material",
  // mesmo sem "Estoque › Visualizar" (o almoxarife que só separa) — a página confere a ação sozinha
  if (seg === "estoque" && (segs[1] === "separacao" || segs[1] === "devolucao")) return null;
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
    pmoc: ["visualizar", "criar", "editar"],
    calendario: ["visualizar"],
    qrcodes: ["visualizar", "gerenciar"],
    equipes: ["visualizar", "gerenciar"],
    veiculos: ["visualizar", "checklist", "gerenciar"],
    desempenho: ["visualizar", "revisar"],
    estoque: ["visualizar", "gerenciar", "separar"],
    relatorios: ["visualizar", "exportar"],
  }),
  FINANCEIRO: montarPermissoes({
    dashboard: ["visualizar"],
    clientes: ["visualizar"],
    ordens: ["visualizar"],
    orcamentos: ["visualizar", "criar", "editar", "aprovar"],
    contratos: ["visualizar", "criar", "editar"],
    licitacoes: ["visualizar", "gerenciar"],
    financeiro: ["visualizar", "medicoes", "contasReceber", "fluxoCaixa", "folha", "fiscal"],
    compras: ["visualizar", "gerenciar"],
    estoque: ["visualizar"],
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

/** Cor de DADO de cada tipo de perfil (gravada no cadastro): paleta única em lib/ui/tokens.ts. */
export const CORES_PERFIL: Record<string, string> = {
  ADMINISTRADOR: corDado.vermelho,
  SUPERVISOR: corDado.ambar,
  FINANCEIRO: corDado.amarelo,
  TECNICO: corDado.azul,
  AUXILIAR: corDado.cinza,
  PERSONALIZADO: corDado.roxo,
};

export const TIPOS_PERFIL_LABEL: Record<string, string> = {
  ADMINISTRADOR: "Administrador",
  SUPERVISOR: "Supervisor",
  FINANCEIRO: "Financeiro",
  TECNICO: "Técnico",
  AUXILIAR: "Auxiliar",
  PERSONALIZADO: "Personalizado",
};
