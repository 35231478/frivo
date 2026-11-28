/**
 * CATÁLOGO DE MÓDULOS — o registro único do que o Frivo tem a oferecer.
 *
 * É a terceira camada de acesso do sistema, ACIMA do RBAC de usuário:
 *
 *   a EMPRESA tem o módulo (entitlement)  ×  o USUÁRIO pode a ação (RBAC)
 *
 * São coisas diferentes e somam: o gestor com todas as permissões do mundo não vê a Frota se a
 * empresa dela não contratou/ligou a Frota; e ter o módulo ligado não dá permissão nenhuma a
 * quem o perfil não dá. Módulo off → o item some do menu, a rota redireciona e a API nega — o
 * mesmo padrão de "permissão blindada" que o RBAC já usa (lib/permissoes.ts).
 *
 * O arquivo é PURO (sem banco, sem React): pode ser importado no servidor, no cliente e nos
 * testes. Quem lê o estado de uma empresa é lib/modulos/servidor.ts.
 *
 * AS REGRAS QUE NÃO MUDAM:
 *   • NÚCLEO NUNCA DESLIGA. Sem Clientes, OS, Calendário, Equipe, Relatório da OS, Configurações
 *     e Dashboard não existe Frivo — `empresaTemModulo` responde true para eles sempre, aconteça
 *     o que acontecer com a tabela.
 *   • AUSÊNCIA = LIGADO. A tabela nasce vazia e só guarda o que alguém desligou de propósito.
 *     Nada de backfill, nada de seed: o sistema de hoje continua idêntico para quem não mexer.
 *   • DESLIGAR NUNCA APAGA. O dado fica; religar restaura. O que o módulo off impede é criar
 *     coisa nova — nunca ler o que já existe.
 *   • DEPENDÊNCIA É RESPEITADA. Compras sem Estoque não faz sentido (o pedido vira entrada de
 *     material), então Compras não fica ligado com Estoque desligado.
 */

/** Categoria só para agrupar na futura loja — não tem efeito nenhum sobre acesso. */
export type CategoriaModulo = "operacao" | "comercial" | "financeiro" | "equipe" | "campo";

export interface ModuloCatalogo {
  /** Identificador estável, gravado no banco. NUNCA muda (o rótulo pode mudar à vontade). */
  id: string;
  nome: string;
  /** Uma linha, em português de gente, dizendo o que a empresa perde ao desligar. */
  descricao: string;
  /** Nome do ícone lucide-react (este arquivo não importa a biblioteca). */
  icone: string;
  categoria: CategoriaModulo;
  /** Núcleo não desliga nunca — nem por SQL direto na tabela. */
  nucleo?: boolean;
  /** Prefixos de rota que pertencem ao módulo (páginas e APIs). */
  rotas?: string[];
  /** Pares [módulo RBAC, ação] que este módulo cobre: é por aqui que a API e o menu são gateados. */
  permissoes?: [modulo: string, acao?: string][];
  /** Ids de módulos que precisam estar ligados para este fazer sentido. */
  dependeDe?: string[];
  /**
   * O gate das 3 camadas (menu, rota, API) já está aplicado a este módulo?
   * A migração é módulo a módulo: enquanto `false`, o módulo existe no catálogo e pode ser
   * desligado na tabela, mas as telas e as rotas dele seguem como sempre foram. Sem isso, um
   * catálogo completo ligaria o gate no sistema inteiro de uma vez — exatamente o risco que o
   * faseamento existe para evitar.
   */
  gateAtivo?: boolean;
}

/* ───────── o núcleo: o Frivo sem isto não é o Frivo ───────── */

const NUCLEO: ModuloCatalogo[] = [
  {
    id: "dashboard", nome: "Dashboard", icone: "LayoutDashboard", categoria: "operacao", nucleo: true,
    descricao: "A visão do dia da empresa.",
    rotas: ["/dashboard"], permissoes: [["dashboard"]],
  },
  {
    id: "clientes", nome: "Clientes", icone: "Users", categoria: "operacao", nucleo: true,
    descricao: "A carteira de clientes, unidades e contatos — tudo no sistema se pendura nela.",
    rotas: ["/clientes"], permissoes: [["clientes"]],
  },
  {
    id: "ordens", nome: "Ordens de serviço", icone: "ClipboardList", categoria: "operacao", nucleo: true,
    descricao: "O coração da operação: abrir, executar e concluir o serviço.",
    rotas: ["/ordens", "/prazos", "/conversas"], permissoes: [["ordens"]],
  },
  {
    id: "calendario", nome: "Calendário", icone: "CalendarDays", categoria: "operacao", nucleo: true,
    descricao: "A agenda das atividades da OS — não é um módulo à parte, é a OS no tempo.",
    rotas: ["/calendario"], permissoes: [["calendario"]],
  },
  {
    id: "equipes", nome: "Equipe", icone: "UsersRound", categoria: "equipe", nucleo: true,
    descricao: "Colaboradores e equipes: sem técnico não há OS.",
    rotas: ["/equipes", "/colaboradores"], permissoes: [["equipes"]],
  },
  {
    id: "relatorio-os", nome: "Relatório da OS", icone: "FileText", categoria: "operacao", nucleo: true,
    descricao: "O documento que prova o serviço feito e vai ao cliente.",
    rotas: ["/relatorio"], permissoes: [["relatorios"]],
  },
  {
    id: "configuracoes", nome: "Configurações", icone: "Settings", categoria: "operacao", nucleo: true,
    descricao: "Os ajustes da empresa — inclusive o que liga e desliga os outros módulos.",
    rotas: ["/configuracoes"], permissoes: [["configuracoes"]],
  },
];

/* ───────── os desligáveis ───────── */

const OPCIONAIS: ModuloCatalogo[] = [
  // ── piloto desta fase: as 3 camadas de gate já valem para estes dois
  {
    id: "veiculos", nome: "Frota", icone: "Truck", categoria: "campo", gateAtivo: true,
    descricao: "Veículos da empresa, com checklist de saída e retorno.",
    rotas: ["/veiculos", "/configuracoes/checklists-veiculo", "/api/veiculos", "/api/checklists", "/api/checklist-templates", "/api/checklist-respostas"],
    permissoes: [["veiculos"]],
  },
  {
    id: "compras", nome: "Compras", icone: "ShoppingCart", categoria: "operacao", gateAtivo: true,
    descricao: "Pedidos de compra ao fornecedor e a entrada do material comprado.",
    rotas: ["/compras", "/api/compras", "/api/pedidos-compra"],
    permissoes: [["compras"]], dependeDe: ["estoque"],
  },

  {
    id: "equipamentos", nome: "Equipamentos", icone: "Thermometer", categoria: "operacao", gateAtivo: true,
    descricao: "O parque de equipamentos do cliente, com histórico e garantia.",
    rotas: ["/equipamentos", "/configuracoes/tipos-equipamento", "/api/equipamentos", "/api/tipos-equipamento"],
    permissoes: [["equipamentos"]],
  },
  {
    id: "qrcodes", nome: "QR Codes", icone: "QrCode", categoria: "operacao", gateAtivo: true,
    descricao: "Etiqueta com QR no equipamento: o cliente aponta a câmera e abre um chamado.",
    // "/qr" e "/api/qr" (o link público da etiqueta) ficam catalogados, mas NÃO são gateados:
    // a etiqueta já colada no equipamento continua abrindo para o cliente — desligar não apaga.
    rotas: ["/qrcodes", "/configuracoes/qr-code", "/api/qrcodes", "/qr", "/api/qr"],
    permissoes: [["qrcodes"]], dependeDe: ["equipamentos"],
  },

  // ── o resto do mapa: catalogado agora, gateado nas fases seguintes
  {
    id: "pmoc", nome: "PMOC", icone: "FileBadge", categoria: "operacao",
    descricao: "Plano de manutenção exigido por lei, com cronograma e documento assinado.",
    rotas: ["/pmoc", "/api/pmocs"], permissoes: [["pmoc"]], dependeDe: ["equipamentos"],
  },
  {
    id: "estoque", nome: "Estoque", icone: "Package", categoria: "operacao", gateAtivo: true,
    descricao: "Saldo de material, separação para a OS e devolução do que sobrou.",
    rotas: ["/estoque", "/api/estoque"], permissoes: [["estoque"]],
  },
  {
    id: "orcamentos", nome: "Orçamentos e leads", icone: "Calculator", categoria: "comercial",
    descricao: "Proposta ao cliente, leads do site e a calculadora pública.",
    rotas: ["/orcamentos", "/leads-site", "/orcamento", "/calculadora", "/api/orcamentos"], permissoes: [["orcamentos"]],
  },
  {
    id: "contratos", nome: "Contratos", icone: "FileText", categoria: "comercial",
    descricao: "Contrato de manutenção, reajuste e a rotina que gera as OS do mês.",
    rotas: ["/contratos", "/api/contratos"], permissoes: [["contratos"]],
  },
  {
    id: "financeiro", nome: "Financeiro", icone: "Wallet", categoria: "financeiro",
    descricao: "Contas a receber e a pagar, medições, fluxo de caixa e tesouraria.",
    rotas: ["/financeiro", "/api/contas-receber", "/api/contas-pagar", "/api/medicoes", "/api/faturamento-contratos"],
    permissoes: [["financeiro", "visualizar"], ["financeiro", "medicoes"], ["financeiro", "contasReceber"], ["financeiro", "fluxoCaixa"], ["financeiro", "perdas"]],
  },
  {
    id: "fiscal", nome: "NFS-e", icone: "FileBadge", categoria: "financeiro",
    descricao: "Emissão da nota fiscal de serviço, com certificado e dados do emitente.",
    rotas: ["/financeiro/notas-fiscais", "/financeiro/fiscal", "/api/fiscal"],
    permissoes: [["financeiro", "fiscal"]], dependeDe: ["financeiro"],
  },
  {
    id: "folha", nome: "Custo de pessoal", icone: "BadgeDollarSign", categoria: "financeiro",
    descricao: "Salários, encargos e benefícios da equipe.",
    rotas: ["/financeiro/custo-pessoal", "/api/folha"],
    permissoes: [["financeiro", "folha"]], dependeDe: ["financeiro"],
  },
  {
    id: "desempenho", nome: "Desempenho", icone: "Trophy", categoria: "equipe",
    descricao: "Escore do colaborador, ranking, premiação e o fechamento do mês.",
    rotas: ["/desempenho", "/api/desempenho"], permissoes: [["desempenho"]],
  },
  {
    id: "admissao", nome: "Admissão digital", icone: "UserPlus", categoria: "equipe",
    descricao: "O novo colaborador preenche a ficha e assina pelo celular, por um link.",
    rotas: ["/admissoes", "/admissao", "/api/admissoes"], permissoes: [["admissao", "gerenciar"]],
  },
  {
    id: "documentos", nome: "Documentos do colaborador", icone: "FileSignature", categoria: "equipe",
    descricao: "Ficha de EPI, termos, advertências e os modelos da empresa.",
    rotas: ["/api/documentos-gerados", "/api/termo-templates"],
    permissoes: [["documentos", "criar"], ["documentos", "gerenciar"], ["documentos", "disciplinar"]],
  },
  {
    id: "documentacao-equipe", nome: "Documentação ao cliente", icone: "FolderOutput", categoria: "equipe",
    descricao: "O pacote de documentos da equipe que vai ao cliente por link, zip ou e-mail.",
    rotas: ["/documentacao-equipe", "/documentacao", "/api/documentacao"],
    permissoes: [["documentos", "enviar"]], dependeDe: ["documentos"],
  },
  {
    id: "app-tecnico", nome: "App do colaborador", icone: "Smartphone", categoria: "campo",
    descricao: "O celular do técnico em campo: Meu dia, execução guiada e fotos.",
    rotas: ["/tecnico", "/equipes/app-colaborador", "/api/tecnico"], permissoes: [["configuracoes", "gerenciar"]],
  },
  {
    id: "mapa", nome: "Mapa da equipe", icone: "MapPinned", categoria: "campo",
    descricao: "Última posição dos técnicos no mapa, nos momentos-chave do atendimento.",
    rotas: ["/mapa", "/api/mapa"], permissoes: [["equipes", "gerenciar"]], dependeDe: ["app-tecnico"],
  },
  {
    id: "portal", nome: "Portal do cliente", icone: "Headset", categoria: "operacao",
    descricao: "A área do cliente: abrir chamado, acompanhar a OS e aprovar o serviço.",
    rotas: ["/portal", "/api/portal"], permissoes: [],
  },
  {
    id: "relatorios", nome: "Relatórios gerenciais", icone: "BarChart3", categoria: "operacao",
    descricao: "Cumprimento de prazos e os relatórios que saem para o cliente.",
    rotas: ["/ordens/cumprimento", "/api/relatorios"], permissoes: [["relatorios"]],
  },
];

export const MODULOS_CATALOGO: ModuloCatalogo[] = [...NUCLEO, ...OPCIONAIS];

/** Ids do núcleo — a lista que `empresaTemModulo` responde `true` sem nem olhar o banco. */
export const MODULOS_NUCLEO: string[] = NUCLEO.map((m) => m.id);

/** Ids que a empresa pode desligar. */
export const MODULOS_OPCIONAIS: string[] = OPCIONAIS.map((m) => m.id);

/** Os que já têm o gate das 3 camadas valendo (o piloto desta fase). */
export const MODULOS_COM_GATE: string[] = MODULOS_CATALOGO.filter((m) => m.gateAtivo).map((m) => m.id);

export const moduloCatalogo = (id: string): ModuloCatalogo | null => MODULOS_CATALOGO.find((m) => m.id === id) ?? null;

export const ehModuloNucleo = (id: string): boolean => MODULOS_NUCLEO.includes(id);

export const rotuloModulo = (id: string): string => moduloCatalogo(id)?.nome ?? id;

/* ───────── do RBAC para o módulo ───────── */

/**
 * O módulo de produto a que uma permissão de RBAC pertence — e `null` quando a permissão é de
 * núcleo (ou de um módulo que ainda não tem gate). É por aqui que `exigirPermissao` sabe se
 * precisa conferir o entitlement: uma função, um lugar, nenhum `if` espalhado pelas 500 rotas.
 *
 * Só devolve módulo com `gateAtivo`: enquanto a migração não chega num módulo, a API dele
 * continua exatamente como sempre foi.
 */
export function moduloDaPermissao(modulo: string, acao: string = "visualizar"): string | null {
  for (const m of MODULOS_CATALOGO) {
    if (!m.gateAtivo || m.nucleo) continue;
    for (const [rbac, a] of m.permissoes ?? []) {
      if (rbac === modulo && (a === undefined || a === acao)) return m.id;
    }
  }
  return null;
}

/** O módulo (com gate) dono de uma rota — prefixo mais longo vence. `null` = rota sem gate. */
export function moduloDaRotaModular(pathname: string): string | null {
  let melhor: { base: string; id: string } | null = null;
  for (const m of MODULOS_CATALOGO) {
    if (!m.gateAtivo || m.nucleo) continue;
    for (const base of m.rotas ?? []) {
      if ((pathname === base || pathname.startsWith(base + "/")) && (!melhor || base.length > melhor.base.length)) {
        melhor = { base, id: m.id };
      }
    }
  }
  return melhor?.id ?? null;
}

/* ───────── o estado de uma empresa ───────── */

/**
 * Os módulos DESLIGADOS de uma empresa — é só isso que o banco guarda. Um conjunto vazio (a
 * esmagadora maioria) significa "tudo ligado", que é o estado de todo mundo hoje.
 */
export type ModulosDesligados = ReadonlySet<string>;

export const TUDO_LIGADO: ModulosDesligados = new Set<string>();

/**
 * A pergunta que o sistema inteiro faz. Núcleo é sempre `true` — nem o banco derruba.
 * Módulo que não existe no catálogo também é `true`: id desconhecido não bloqueia ninguém
 * (um dado velho na tabela nunca pode esconder uma tela que existe).
 */
export function empresaTemModulo(desligados: ModulosDesligados | null | undefined, id: string): boolean {
  if (ehModuloNucleo(id)) return true;
  // Id que não está no catálogo (módulo renomeado, linha velha no banco) NUNCA bloqueia: um dado
  // esquecido na tabela não pode esconder uma tela que existe.
  if (!moduloCatalogo(id)) return true;
  if (!desligados) return true;
  return !desligados.has(id);
}

/**
 * Quem o `id` arrasta junto ao ser desligado: os módulos ligados que dependem dele (em cascata).
 * Desligar Estoque arrasta Compras — senão sobraria um pedido de compra que não consegue dar
 * entrada em lugar nenhum.
 *
 * Só entram na lista os módulos com `gateAtivo`: a dependência de um módulo ainda não gateado
 * (PMOC → Equipamentos) fica registrada no catálogo e vale na hora de LIGAR (`dependenciasFaltando`),
 * mas não é anunciada nem gravada agora — dizer "o PMOC vai junto" e o PMOC continuar inteiro no
 * menu seria mentir para quem está desligando. A travessia segue passando por ele, para o caso de
 * alguém depender do dependente.
 */
export function dependentesLigados(desligados: ModulosDesligados, id: string): string[] {
  const fora = new Set(desligados);
  const arrastados: string[] = [];
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const m of MODULOS_CATALOGO) {
      if (m.nucleo || fora.has(m.id) || arrastados.includes(m.id)) continue;
      if ((m.dependeDe ?? []).some((d) => d === id || fora.has(d) || arrastados.includes(d))) {
        arrastados.push(m.id);
        mudou = true;
      }
    }
  }
  return arrastados.filter((m) => moduloCatalogo(m)?.gateAtivo);
}

/** O que falta ligar para o `id` poder ser ligado (dependências desligadas, em cascata). */
export function dependenciasFaltando(desligados: ModulosDesligados, id: string): string[] {
  const faltando: string[] = [];
  const visitar = (alvo: string) => {
    for (const d of moduloCatalogo(alvo)?.dependeDe ?? []) {
      if (!empresaTemModulo(desligados, d) && !faltando.includes(d)) { faltando.push(d); visitar(d); }
    }
  };
  visitar(id);
  return faltando;
}

/** A frase que a tela mostra ao desligar algo que arrasta outros. */
export function avisoDependencia(arrastados: string[]): string {
  if (!arrastados.length) return "";
  const nomes = arrastados.map(rotuloModulo);
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
  return `${lista} ${nomes.length === 1 ? "depende" : "dependem"} deste módulo e ${nomes.length === 1 ? "será desligado" : "serão desligados"} junto. Nada é apagado: religando, tudo volta como estava.`;
}

/** Mensagem única da API quando o módulo está desligado (a tela mostra tal e qual). */
export const MSG_MODULO_DESLIGADO = (id: string) =>
  `O módulo ${rotuloModulo(id)} está desligado para esta empresa. Ligue em Configurações para usar de novo.`;
