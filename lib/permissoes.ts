/**
 * Núcleo de controle de acesso por perfil (RBAC) do Frivo.
 * Arquivo puro (sem dependências de Node) — pode ser importado no servidor,
 * no client e no middleware (Edge). Só importa constantes de lib/ui/tokens.ts.
 */
import { corDado } from "@/lib/ui/tokens";

export type Acao =
  | "visualizar" | "criar" | "editar" | "excluir" | "concluir" | "aprovar"
  | "gerenciar" | "medicoes" | "contasReceber" | "fluxoCaixa" | "folha" | "fiscal" | "perdas" | "checklist" | "exportar"
  | "separar" | "revisar" | "disciplinar" | "enviar" | "verCusto" | "alterarPrecoTabela";

export type Permissoes = Record<string, Partial<Record<Acao, boolean>>>;

/** Nome do ícone (lucide-react) que representa o módulo na UI — este arquivo não importa a biblioteca. */
export type IconeModulo =
  | "ClipboardList" | "Users" | "Thermometer" | "CalendarDays" | "QrCode" | "Package" | "ShoppingCart" | "Calculator"
  | "FileText" | "Wallet" | "UsersRound" | "Truck" | "Settings" | "BarChart3" | "LayoutDashboard" | "FileBadge" | "Trophy"
  | "UserPlus" | "FileSignature";
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
  disciplinar: "Advertência e suspensão",
  enviar: "Enviar ao cliente",
  verCusto: "Ver custo e margem",
  alterarPrecoTabela: "Alterar preço de tabela",
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
      // verCusto: custo dos produtos/materiais, lucro e margem no Editar orçamento. Nunca vai ao PDF nem ao link do
      // cliente; sem ela, o custo nem chega ao navegador (lib/orcamentos/estoque-margem-server). Padrão: só administrador.
      // alterarPrecoTabela: o preço que vem da tabela de preço do cliente fica travado no orçamento E na OS; com
      // esta permissão a pessoa altera, informando o motivo (vai para a trilha). Perfil gravado antes não a tem
      // (fica travado); o administrador tem sempre (lib/precos/trava-tabela).
      { id: "orcamentos", label: "Orçamentos", icone: "Calculator", acoes: ["visualizar", "criar", "editar", "aprovar", "excluir", "verCusto", "alterarPrecoTabela"] },
      // excluir = CANCELAR o contrato (nada é apagado), como em OS e orçamentos. Perfil gravado antes desta
      // permissão não a tem: o administrador marca em Configurações › Perfis de acesso (o SQL opcional está
      // em docs/sql-opcional/contratos-excluir.sql). Administrador e super admin podem tudo, sem nada no banco.
      { id: "contratos", label: "Contratos", icone: "FileText", acoes: ["visualizar", "criar", "editar", "excluir"] },
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
      // Admissão digital: gerar o convite, acompanhar o preenchimento, baixar a ficha e os
      // documentos, cancelar. Dado sensível do colaborador — fica separado de "Equipes".
      { id: "admissao", label: "Admissão digital", icone: "UserPlus", acoes: ["gerenciar"] },
      // Documentos do colaborador: "gerenciar" = os MODELOS da empresa (Configurações); "criar" =
      // gerar e assinar um documento na ficha de alguém; "disciplinar" = advertência e suspensão,
      // que é papel sensível — quem não tem não gera E não vê na lista de documentos da pessoa;
      // "enviar" = montar o pacote de documentação da equipe e mandá-lo ao CLIENTE (link, zip ou
      // e-mail). É dado de pessoa saindo da empresa: ação própria, que ninguém herda de "criar".
      { id: "documentos", label: "Documentos do colaborador", icone: "FileSignature", acoes: ["criar", "gerenciar", "disciplinar", "enviar"] },
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
const MODULOS_POR_ID = new Set(MODULOS.map((m) => m.id));

/**
 * Módulos que já existiram e saíram do sistema. A chave pode continuar nos perfis gravados (nada é
 * apagado); aqui só fica registrado o porquê.
 *  - "licitacoes" (Licitações): só existia como permissão (no cadastro de perfis e no preset Financeiro) —
 *    nunca teve tela, rota de API, item de menu nem tabela. Saiu na leva 3.
 */
export const MODULOS_REMOVIDOS = ["licitacoes"] as const;

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
 * Pode ENTRAR na área do módulo? É a pergunta do portão do middleware e do menu.
 *  - módulo com a ação "visualizar" (quase todos): é ela que abre a área;
 *  - módulo SEM "visualizar" (Admissão digital, Documentos do colaborador): não há o que "ver"
 *    separado de fazer — entra quem tem QUALQUER ação do módulo, e a página confere a ação certa.
 * Assim o portão nunca exige uma ação que o módulo não tem (o bug do /admissoes, em que só o
 * administrador master passava), e quem não tem nada do módulo continua barrado já no portão.
 */
export function podeEntrarNoModulo(
  permissoes: Permissoes | null | undefined,
  modulo: string,
  role?: string,
): boolean {
  const def = MODULOS.find((m) => m.id === modulo);
  if (!def || def.acoes.includes("visualizar")) return pode(permissoes, modulo, "visualizar", role);
  return def.acoes.some((a) => pode(permissoes, modulo, a, role));
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
    // Módulo que não existe mais (ex.: "licitacoes", removido na leva 3) não concede nada: a chave fica nos
    // perfis gravados (nada é apagado), mas não pode travar quem edita um perfil por uma permissão invisível
    if (!MODULOS_POR_ID.has(modulo)) continue;
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
  financeiro: "financeiro",
  equipes: "equipes",
  colaboradores: "equipes",
  admissoes: "admissao",            // sem "visualizar": entra quem tem alguma ação (podeEntrarNoModulo)
  "documentacao-equipe": "documentos", // idem; a página exige "Documentos › Enviar ao cliente"
  desempenho: "desempenho",
  veiculos: "veiculos",
  estoque: "estoque",
  configuracoes: "configuracoes",
  compras: "compras",
  "leads-site": "orcamentos",   // leads do site são orçamentos (nome/WhatsApp/valores)
};

/**
 * Itens de Configurações cuja permissão NÃO é "Configurações › Visualizar": cada um tem o módulo e a
 * ação próprios (lib/navegacao/configuracoes.ts). A rota antiga deles só redireciona para a página
 * de Configurações, que confere item a item — por isso não passa pelo portão de "Configurações".
 * (Um teste mantém esta lista igual à dos itens com permissão própria.)
 */
export const CONFIG_COM_PERMISSAO_PROPRIA = ["dados-fiscais", "admissao", "modelos-documento"];

/**
 * Retorna o módulo da rota — aquele em que o middleware exige poder ENTRAR (`podeEntrarNoModulo`:
 * "visualizar", ou qualquer ação quando o módulo não tem "visualizar") — ou null se a rota não tem
 * esse portão. Rota sem portão NÃO é rota aberta: é rota em que a PÁGINA confere sozinha a
 * permissão certa (e o servidor confere de novo em cada rota de API). Entram aqui as telas cuja
 * permissão é uma AÇÃO que não depende de "visualizar" o módulo do endereço — sem isso o menu
 * mostra o item e o middleware barra quem tem a permissão. (A página de Configurações também sai
 * do portão, mas por `portaoBarra`: o módulo dela continua sendo "configuracoes".)
 */
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
  // Exceção: Equipes › App do colaborador é de quem tem "Configurações › Gerenciar" — o endereço
  // mora em /equipes, mas não pede "Equipes › Visualizar". A página confere a ação sozinha.
  if (seg === "equipes" && segs[1] === "app-colaborador") return null;
  // Exceção: Operações › Cumprimento de prazos é do módulo Relatórios ("Relatórios › Visualizar") —
  // o endereço mora em /ordens, mas quem lê o relatório do SLA não precisa ver a lista de OS.
  // A página confere a permissão sozinha (e manda para /ordens quem não a tem).
  if (seg === "ordens" && segs[1] === "cumprimento") return null;
  return ROTA_MODULO[seg] ?? null;
}

/**
 * A página de Configurações (e a rota antiga dos itens com permissão própria, que só redireciona
 * para ela) se guarda sozinha: mostra só os cartões que o perfil pode abrir e manda para
 * /sem-permissao quem não pode abrir nenhum. Quem tem só "Financeiro › Fiscal", "Admissão digital"
 * ou os modelos de documento chega ao item dele — sem ver o resto.
 *
 * Fica FORA de `moduloDaRota` de propósito: o módulo de /configuracoes continua sendo
 * "configuracoes", porque é por ele que os cartões comuns (Empresa, Preferências…) decidem quem vê.
 */
function configuracoesSeGuarda(pathname: string): boolean {
  const segs = pathname.split("/").filter(Boolean);
  return segs[0] === "configuracoes" && (segs.length === 1 || (segs.length === 2 && CONFIG_COM_PERMISSAO_PROPRIA.includes(segs[1])));
}

/**
 * O PORTÃO do middleware: a rota pede para entrar num módulo e o perfil não pode (`podeEntrarNoModulo`)? Então barra
 * (o middleware manda para /sem-permissao). Função pura para a regra ser a mesma no middleware e
 * nos testes — e para ficar claro o que o portão NÃO decide: as rotas em que `moduloDaRota` devolve
 * null passam por aqui e são conferidas pela própria página.
 */
export function portaoBarra(pathname: string, permissoes: Permissoes | null | undefined, role?: string): boolean {
  if (configuracoesSeGuarda(pathname)) return false;
  const modulo = moduloDaRota(pathname);
  return !!modulo && pathname !== "/sem-permissao" && !podeEntrarNoModulo(permissoes, modulo, role);
}

/**
 * Para onde o middleware manda quem o portão barrou: /sem-permissao com o endereço pedido em `de`.
 * Com ele, /sem-permissao consegue perceber que o acesso foi concedido DEPOIS do login (o token do
 * middleware ainda é o antigo) e devolver a pessoa ao endereço, sem pedir que ela saia e entre.
 */
export function destinoSemPermissao(pathname: string): string {
  return `/sem-permissao?de=${encodeURIComponent(pathname)}`;
}

/**
 * O `de` de /sem-permissao só é aceito se for um caminho DESTE sistema: começa com uma barra, não
 * com duas (//outro-site.com) nem com barra invertida, e não volta para a própria /sem-permissao.
 * Qualquer outra coisa vira null — nada de redirecionar para fora a partir de um parâmetro de URL.
 */
export function rotaInternaSegura(de: string | null | undefined): string | null {
  if (typeof de !== "string" || de.length === 0 || de.length > 512) return null;
  if (!de.startsWith("/") || de.startsWith("//") || de.includes("\\") || /[\u0000-\u001f]/.test(de)) return null;
  if (de === "/sem-permissao" || de.startsWith("/sem-permissao?") || de.startsWith("/sem-permissao/")) return null;
  return de;
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
    desempenho: ["visualizar"], // revisar penalidades concede-se explicitamente
    estoque: ["visualizar", "gerenciar", "separar"],
    relatorios: ["visualizar", "exportar"],
  }),
  FINANCEIRO: montarPermissoes({
    dashboard: ["visualizar"],
    clientes: ["visualizar"],
    ordens: ["visualizar"],
    orcamentos: ["visualizar", "criar", "editar", "aprovar"],
    contratos: ["visualizar", "criar", "editar", "excluir"],
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
