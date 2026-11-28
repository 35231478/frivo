/**
 * O que uma EMPRESA NOVA ganha ao nascer: os 5 perfis de acesso padrão e os 6 tipos de OS de
 * climatização. Regra pura (sem banco): a gravação está em lib/empresa/criar-empresa.ts.
 *
 * Perfis (decisão de produto, leva "Pronto pra janeiro 2"): a partir dos presets do código
 * (lib/permissoes.ts › PRESETS), SEM mudar os presets:
 *  - Administrador = preset ADMINISTRADOR;
 *  - Gestor        = preset SUPERVISOR, só com outro nome;
 *  - Financeiro    = preset FINANCEIRO;
 *  - Técnico       = preset TECNICO (o "Acesso ao app" do colaborador procura o perfil deste tipo);
 *  - Vendas        = perfil PERSONALIZADO com o preset abaixo (o enum não tem "Vendas" e não precisa).
 * O Auxiliar deixou de nascer com a empresa (continua existindo como tipo e preset).
 *
 * Tipos de OS: só PMOC e Manutenção Preventiva exigem equipamento para concluir; os demais concluem
 * sem equipamento (o que for atendido continua pedindo o checklist).
 */
import { PRESETS, CORES_PERFIL, montarPermissoes, type Permissoes } from "@/lib/permissoes";

/**
 * Vendas: atende o comercial sem aprovar orçamento nem ver custo (o envio do orçamento é "editar").
 * COM-1: nasce com "Ver só os próprios" em Orçamentos e OS — cada vendedor vê os orçamentos em que é o vendedor e as
 * OS ligadas a eles. Só para empresas NOVAS: os perfis que já existem não são alterados.
 */
export const PRESET_VENDAS: Permissoes = montarPermissoes({
  dashboard: ["visualizar"],
  clientes: ["visualizar", "criar", "editar"],
  // Leads do site ficam dentro de Orçamentos (visualizar)
  orcamentos: ["visualizar", "criar", "editar", "verSoProprios"],
  ordens: ["verSoProprios"],
  contratos: ["visualizar"],
});

export interface PerfilPadrao {
  nome: string;
  tipo: "ADMINISTRADOR" | "SUPERVISOR" | "FINANCEIRO" | "TECNICO" | "PERSONALIZADO";
  descricao: string;
  cor: string;
  permissoes: Permissoes;
}

const copia = (p: Permissoes): Permissoes => JSON.parse(JSON.stringify(p));

export function perfisPadrao(): PerfilPadrao[] {
  return [
    { nome: "Administrador", tipo: "ADMINISTRADOR", descricao: "Acesso total ao sistema", cor: CORES_PERFIL.ADMINISTRADOR, permissoes: copia(PRESETS.ADMINISTRADOR) },
    { nome: "Gestor", tipo: "SUPERVISOR", descricao: "OS, clientes, equipes, estoque e relatórios", cor: CORES_PERFIL.SUPERVISOR, permissoes: copia(PRESETS.SUPERVISOR) },
    { nome: "Financeiro", tipo: "FINANCEIRO", descricao: "Financeiro, contratos, orçamentos e clientes", cor: CORES_PERFIL.FINANCEIRO, permissoes: copia(PRESETS.FINANCEIRO) },
    { nome: "Técnico", tipo: "TECNICO", descricao: "OS, equipamentos, calendário e veículos (app do técnico)", cor: CORES_PERFIL.TECNICO, permissoes: copia(PRESETS.TECNICO) },
    { nome: "Vendas", tipo: "PERSONALIZADO", descricao: "Clientes, orçamentos e leads (sem aprovar e sem ver custo)", cor: CORES_PERFIL.PERSONALIZADO, permissoes: copia(PRESET_VENDAS) },
  ];
}

export interface TipoOsPadrao {
  nome: string;
  descricao: string;
  cor: string;
  exigeEquipamento: boolean;
}

export const TIPOS_OS_PADRAO: readonly TipoOsPadrao[] = [
  { nome: "Instalação", descricao: "Instalação de novos equipamentos", cor: "#3b82f6", exigeEquipamento: false },
  { nome: "Manutenção Preventiva", descricao: "Manutenção programada periódica", cor: "#22c55e", exigeEquipamento: true },
  { nome: "Manutenção Corretiva", descricao: "Reparo de falhas e defeitos", cor: "#ef4444", exigeEquipamento: false },
  { nome: "Visita Técnica", descricao: "Diagnóstico e avaliação no local", cor: "#8b5cf6", exigeEquipamento: false },
  { nome: "PMOC", descricao: "Execução do Plano de Manutenção, Operação e Controle", cor: "#0d9488", exigeEquipamento: true },
  { nome: "Orçamento/Vistoria", descricao: "Levantamento para orçamento", cor: "#f59e0b", exigeEquipamento: false },
];

/** Nome comparável (sem acento, caixa e espaços extras): "Manutenção  preventiva" = "manutencao preventiva" */
export const chaveNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Dos padrões, os que faltam: o que já existe com o mesmo nome (sem olhar acento e caixa) fica como
 * está — nunca altera nem duplica o que a empresa já tem.
 */
export function faltando<T extends { nome: string }>(padroes: readonly T[], existentes: readonly { nome: string }[]): T[] {
  const tem = new Set(existentes.map((e) => chaveNome(e.nome)));
  return padroes.filter((p) => !tem.has(chaveNome(p.nome)));
}
